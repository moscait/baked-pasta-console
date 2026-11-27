package com.example.sessions;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import com.example.ziti.Json;

/**
 * Session correlation, client-IP traffic filtering, and concurrent identity session detection
 * for OpenZiti networks. Framework-free.
 */
public final class SessionMonitor {

    private SessionMonitor() {
    }

    // ------------------------------------------------------------------ policy

    public enum RemediationAction {
        WARN("warn", "Warn only"),
        TERMINATE_NEWER("terminate-newer-sessions", "Terminate newer sessions"),
        TERMINATE_ALL("terminate-all-sessions", "Terminate all sessions"),
        REVOKE("revoke-authenticators", "Revoke credentials + sessions");

        public final String id;
        public final String label;

        RemediationAction(String id, String label) {
            this.id = id;
            this.label = label;
        }
    }

    /** What counts as "concurrent" sessions on one identity. */
    public static final class ConcurrencyPolicy {
        /** Max age (s) since last activity for an API session to count as live; 0 disables. */
        public int activeWithinSeconds = 300;
        /** Max gap (s) from the newest active session to join the cluster; null disables. */
        public Integer maxActivitySkewSeconds = 120;
        public int minConcurrentSessions = 2;
        public boolean requireDistinctIps = false;
        public boolean exemptAdminIdentities = true;
        public boolean exemptExternalIdentities = true;
        public List<String> exemptRoleAttributes = new ArrayList<>(List.of("multi-device"));
        public List<String> exemptIdentityIds = new ArrayList<>();
        public RemediationAction sameIpAction = RemediationAction.WARN;
        public RemediationAction multiIpAction = RemediationAction.WARN;

        public ConcurrencyPolicy copy() {
            ConcurrencyPolicy c = new ConcurrencyPolicy();
            c.activeWithinSeconds = activeWithinSeconds;
            c.maxActivitySkewSeconds = maxActivitySkewSeconds;
            c.minConcurrentSessions = minConcurrentSessions;
            c.requireDistinctIps = requireDistinctIps;
            c.exemptAdminIdentities = exemptAdminIdentities;
            c.exemptExternalIdentities = exemptExternalIdentities;
            c.exemptRoleAttributes = new ArrayList<>(exemptRoleAttributes);
            c.exemptIdentityIds = new ArrayList<>(exemptIdentityIds);
            c.sameIpAction = sameIpAction;
            c.multiIpAction = multiIpAction;
            return c;
        }

        /** Clamps values and cleans the exemption lists, like normalizeConcurrencyPolicy. */
        public ConcurrencyPolicy normalized() {
            ConcurrencyPolicy c = copy();
            c.activeWithinSeconds = Math.max(0, c.activeWithinSeconds);
            c.maxActivitySkewSeconds = c.maxActivitySkewSeconds != null && c.maxActivitySkewSeconds > 0
                    ? c.maxActivitySkewSeconds : null;
            c.minConcurrentSessions = Math.max(2, c.minConcurrentSessions);
            c.exemptRoleAttributes = new ArrayList<>(c.exemptRoleAttributes.stream().map(a -> a.trim().replaceFirst("^#", ""))
                    .filter(a -> !a.isEmpty()).collect(Collectors.toCollection(LinkedHashSet::new)));
            c.exemptIdentityIds = new ArrayList<>(c.exemptIdentityIds.stream().map(String::trim).filter(a -> !a.isEmpty())
                    .collect(Collectors.toCollection(LinkedHashSet::new)));
            return c;
        }
    }

    // ------------------------------------------------------------------ results

    public record RemediationStep(String path, String collection, String targetId, String reason) {
    }

    public record RemediationPlan(List<RemediationStep> steps, String error) {
    }

    public record ConcurrentSessionSnapshot(String apiSessionId, String ipAddress, String createdAt, String activityAt,
            Long ageSeconds, List<String> services, boolean isCurrentSession) {
    }

    public record ConcurrencyFinding(String identityId, String identityName, List<String> roleAttributes,
            String authMethod, String severity, int concurrentSessionCount, int totalSessionCount,
            List<String> distinctIps, List<ConcurrentSessionSnapshot> concurrentSessions, Long activitySkewMs,
            RemediationAction recommendedAction, List<RemediationStep> remediationSteps, String summary) {
    }

    public record ServiceRef(String sessionId, String serviceId, String serviceName, String type, List<String> routers,
            String createdAt) {
    }

    public record EnrichedApiSession(String id, String identityId, String identityName, boolean isAdmin,
            List<String> roleAttributes, String authMethod, boolean isExternalIdentity, String authenticatorId,
            String ipAddress, String rawIpAddress, String createdAt, String activityAt, Long ageSeconds,
            boolean isActiveInWindow, boolean isCurrentSession, String concurrencyState, List<ServiceRef> services) {
    }

    public record ServiceFlowRow(String id, String sessionId, String apiSessionId, String identityId,
            String identityName, List<String> roleAttributes, String authMethod, String ipAddress, String serviceId,
            String serviceName, String type, List<String> routers, String activityAt, Long ageSeconds,
            boolean isCurrentSession, String concurrencyState, String findingSeverity) {
    }

    public static final class IdentitySummary {
        public String identityId;
        public String identityName;
        public boolean isAdmin;
        public List<String> roleAttributes;
        public String authMethod;
        public boolean isExternalIdentity;
        public int totalSessionCount;
        public int liveSessionCount;
        public List<String> distinctLiveIps = new ArrayList<>();
        public List<String> allIps = new ArrayList<>();
        public List<String> activeServiceIds = new ArrayList<>();
        public List<String> activeServiceNames = new ArrayList<>();
        public String concurrencyState = "single";
        public ConcurrencyFinding finding;
    }

    public record Report(String evaluatedAt, long nowMs, ConcurrencyPolicy policy, List<EnrichedApiSession> apiSessions,
            List<ServiceFlowRow> serviceFlows, Map<String, IdentitySummary> byIdentity,
            List<ConcurrencyFinding> findings) {
    }

    // ------------------------------------------------------------------ helpers

    public static String inferAuthMethod(Map<String, Object> identity, List<Map<String, Object>> authenticators) {
        if (identity == null) {
            return "unknown";
        }
        if (Json.str(identity, "externalId") != null && !Json.str(identity, "externalId").isEmpty()) {
            return "ext-jwt";
        }
        if (Json.path(identity, "authenticators.cert") != null) {
            return "cert";
        }
        if (Json.path(identity, "authenticators.updb") != null) {
            return "updb";
        }
        if (authenticators != null) {
            String id = Json.str(identity, "id");
            List<Map<String, Object>> own = authenticators.stream()
                    .filter(a -> id.equals(Json.str(a, "identityId")) || id.equals(Json.str(a, "identity.id"))).toList();
            if (own.stream().anyMatch(a -> "cert".equals(a.get("method")))) {
                return "cert";
            }
            if (own.stream().anyMatch(a -> "updb".equals(a.get("method")))) {
                return "updb";
            }
        }
        return "unknown";
    }

    static Long parseMs(String iso) {
        if (iso == null || iso.isEmpty()) {
            return null;
        }
        try {
            return Instant.parse(iso).toEpochMilli();
        } catch (Exception e) {
            try {
                return java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli();
            } catch (Exception e2) {
                return null;
            }
        }
    }

    private static String activityIso(Map<String, Object> s) {
        for (String k : List.of("lastActivityAt", "cachedLastActivityAt", "updatedAt", "createdAt")) {
            String v = Json.str(s, k);
            if (v != null && !v.isEmpty()) {
                return v;
            }
        }
        return null;
    }

    private static final Set<String> NON_REVOCABLE = Set.of("", "oidc", "ext-jwt", "internal", "none");

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    record SessionRef(String id, String ipAddress, String createdAt, String authenticatorId, boolean isCurrentSession) {
    }

    public static RemediationPlan buildRemediationPlan(RemediationAction action, Map<String, Object> identity,
            String identityName, List<SessionRef> allApiSessions, List<ConcurrentSessionSnapshot> concurrentSessions,
            List<Map<String, Object>> authenticators) {
        if (action == RemediationAction.WARN) {
            return new RemediationPlan(List.of(), null);
        }
        if (action == RemediationAction.TERMINATE_NEWER) {
            // Keep the earliest-established session and never drop the caller's own session.
            List<ConcurrentSessionSnapshot> ordered = new ArrayList<>(concurrentSessions);
            ordered.sort((a, b) -> {
                if (a.isCurrentSession() != b.isCurrentSession()) {
                    return a.isCurrentSession() ? -1 : 1;
                }
                Long ca = parseMs(a.createdAt());
                Long cb = parseMs(b.createdAt());
                if (ca != null && cb != null && !ca.equals(cb)) {
                    return Long.compare(ca, cb);
                }
                if (ca != null && cb == null) {
                    return -1;
                }
                if (ca == null && cb != null) {
                    return 1;
                }
                return a.apiSessionId().compareTo(b.apiSessionId());
            });
            List<RemediationStep> steps = ordered.stream().skip(1).filter(s -> !s.isCurrentSession())
                    .map(s -> new RemediationStep("api-sessions/" + enc(s.apiSessionId()), "api-sessions", s.apiSessionId(),
                            "Terminate newer concurrent API session (" + Objects.requireNonNullElse(s.ipAddress(), "unknown IP")
                                    + ") on " + identityName))
                    .toList();
            return new RemediationPlan(steps, null);
        }
        List<RemediationStep> sessSteps = allApiSessions.stream().filter(s -> !s.isCurrentSession())
                .map(s -> new RemediationStep("api-sessions/" + enc(s.id()), "api-sessions", s.id(),
                        "Terminate API session (" + Objects.requireNonNullElse(s.ipAddress(), "unknown IP") + ") on "
                                + identityName))
                .toList();
        if (action == RemediationAction.TERMINATE_ALL) {
            return new RemediationPlan(sessSteps, null);
        }
        // Revoke: require a concrete authenticator id, so sessions are never dropped alone while
        // reporting that credentials were revoked.
        Set<String> ids = new LinkedHashSet<>();
        java.util.function.Consumer<String> add = id -> {
            String clean = id == null ? "" : id.trim();
            if (!clean.isEmpty() && !NON_REVOCABLE.contains(clean.toLowerCase())) {
                ids.add(clean);
            }
        };
        add.accept(Json.str(identity, "authenticators.cert.id"));
        add.accept(Json.str(identity, "authenticators.updb.id"));
        allApiSessions.forEach(s -> add.accept(s.authenticatorId()));
        if (identity != null && authenticators != null) {
            String iid = Json.str(identity, "id");
            for (Map<String, Object> a : authenticators) {
                if (iid.equals(Json.str(a, "identityId")) || iid.equals(Json.str(a, "identity.id"))) {
                    add.accept(Json.str(a, "id"));
                }
            }
        }
        if (ids.isEmpty()) {
            return new RemediationPlan(List.of(), "Cannot revoke credentials for " + identityName
                    + ": no revocable authenticator ID was found on the identity or its sessions.");
        }
        List<RemediationStep> steps = new ArrayList<>();
        for (String authId : ids) {
            steps.add(new RemediationStep("authenticators/" + enc(authId), "authenticators", authId,
                    "Revoke authenticator " + authId + " on " + identityName + " to invalidate shared credentials"));
        }
        steps.addAll(sessSteps);
        return new RemediationPlan(steps, null);
    }

    /** Remediation plan for an action chosen in the UI for one finding. */
    public static RemediationPlan planFor(RemediationAction action, ConcurrencyFinding f, Report report,
            Map<String, Object> identity, List<Map<String, Object>> authenticators) {
        List<SessionRef> all = report.apiSessions().stream().filter(s -> s.identityId().equals(f.identityId()))
                .map(s -> new SessionRef(s.id(), s.ipAddress(), s.createdAt(), s.authenticatorId(), s.isCurrentSession()))
                .toList();
        return buildRemediationPlan(action, identity, f.identityName(), all, f.concurrentSessions(), authenticators);
    }

    // ------------------------------------------------------------------ evaluation

    private static final class Inter {
        Map<String, Object> raw;
        String id;
        String identityId;
        String ip;
        String createdAt;
        String activityIso;
        Long activityMs;
        Long ageSeconds;
        boolean active;
        boolean current;
        List<ServiceRef> services;
    }

    public static Report evaluate(List<Map<String, Object>> identities, List<Map<String, Object>> apiSessions,
            List<Map<String, Object>> sessions, List<Map<String, Object>> authenticators, ConcurrencyPolicy rawPolicy,
            String currentSessionToken, long nowMs) {
        ConcurrencyPolicy policy = rawPolicy.normalized();
        Map<String, Map<String, Object>> identityById = new HashMap<>();
        identities.forEach(i -> identityById.put(Json.str(i, "id"), i));

        Map<String, List<ServiceRef>> servicesByApi = new HashMap<>();
        for (Map<String, Object> sess : sessions) {
            String api = Json.strOr(sess, "apiSessionId", Json.str(sess, "apiSession.id"));
            if (api == null || api.isEmpty()) {
                continue;
            }
            servicesByApi.computeIfAbsent(api, k -> new ArrayList<>()).add(serviceRef(sess));
        }

        Map<String, List<Inter>> byIdent = new LinkedHashMap<>();
        List<Inter> all = new ArrayList<>();
        for (Map<String, Object> raw : apiSessions) {
            Inter it = new Inter();
            it.raw = raw;
            it.id = Json.str(raw, "id");
            it.identityId = Json.strOr(raw, "identityId", Json.strOr(raw, "identity.id", "unknown-identity"));
            it.ip = IpFilter.normalizeIp(Json.str(raw, "ipAddress"));
            it.activityIso = activityIso(raw);
            it.activityMs = parseMs(it.activityIso);
            Long ageMs = it.activityMs == null ? null : Math.max(0, nowMs - it.activityMs);
            it.ageSeconds = ageMs == null ? null : Math.round(ageMs / 1000.0);
            it.active = policy.activeWithinSeconds <= 0 || (ageMs != null && ageMs <= policy.activeWithinSeconds * 1000L);
            String tok = Json.str(raw, "token");
            it.current = currentSessionToken != null && tok != null && tok.equals(currentSessionToken);
            it.createdAt = Json.str(raw, "createdAt");
            it.services = servicesByApi.getOrDefault(it.id, List.of());
            all.add(it);
            byIdent.computeIfAbsent(it.identityId, k -> new ArrayList<>()).add(it);
        }

        Map<String, IdentitySummary> byIdentity = new LinkedHashMap<>();
        List<ConcurrencyFinding> findings = new ArrayList<>();
        Map<String, String> stateById = new HashMap<>();

        for (var entry : byIdent.entrySet()) {
            String identityId = entry.getKey();
            List<Inter> group = entry.getValue();
            group.sort((a, b) -> {
                if (a.activityMs != null && b.activityMs != null && !a.activityMs.equals(b.activityMs)) {
                    return Long.compare(b.activityMs, a.activityMs);
                }
                if (a.activityMs != null && b.activityMs == null) {
                    return -1;
                }
                if (a.activityMs == null && b.activityMs != null) {
                    return 1;
                }
                return a.id.compareTo(b.id);
            });
            Map<String, Object> ident = identityById.get(identityId);
            String identityName = ident != null ? Json.str(ident, "name")
                    : Json.strOr(group.get(0).raw, "identity.name", identityId);
            boolean isAdmin = ident != null && (Json.bool(ident, "isAdmin") || Json.bool(ident, "isDefaultAdmin"));
            List<String> roleAttributes = ident != null ? Json.strings(ident, "roleAttributes") : List.of();
            String authMethod = inferAuthMethod(ident, authenticators);
            boolean isExternal = (ident != null && Json.str(ident, "externalId") != null
                    && !Json.str(ident, "externalId").isEmpty()) || "ext-jwt".equals(authMethod);

            List<Inter> live = group.stream().filter(s -> s.active).toList();
            List<Inter> clustered = policy.maxActivitySkewSeconds == null || live.isEmpty() ? live
                    : live.stream().filter(s -> {
                        Long newest = live.get(0).activityMs;
                        return newest != null && s.activityMs != null
                                && Math.abs(newest - s.activityMs) <= policy.maxActivitySkewSeconds * 1000L;
                    }).toList();
            Long skewMs = null;
            if (clustered.size() >= 2) {
                Long f = clustered.get(0).activityMs;
                Long l = clustered.get(clustered.size() - 1).activityMs;
                if (f != null && l != null) {
                    skewMs = Math.abs(f - l);
                }
            }
            List<String> clusterIps = distinctIps(clustered);
            List<String> liveIps = distinctIps(live);
            List<String> allIps = distinctIps(group);
            Set<String> svcIds = new LinkedHashSet<>();
            Set<String> svcNames = new LinkedHashSet<>();
            for (Inter s : live) {
                for (ServiceRef svc : s.services) {
                    if (!svc.serviceId().isEmpty()) {
                        svcIds.add(svc.serviceId());
                    }
                    svcNames.add(svc.serviceName());
                }
            }
            boolean meetsCount = clustered.size() >= policy.minConcurrentSessions;
            boolean multiIp = clusterIps.size() >= 2;
            boolean meetsIp = !policy.requireDistinctIps || multiIp;
            boolean exempt = (policy.exemptAdminIdentities && isAdmin) || policy.exemptIdentityIds.contains(identityId)
                    || roleAttributes.stream().anyMatch(policy.exemptRoleAttributes::contains)
                    || (policy.exemptExternalIdentities && isExternal);

            String state = "single";
            ConcurrencyFinding finding = null;
            Set<String> clusteredIds = clustered.stream().map(s -> s.id).collect(Collectors.toSet());
            if (meetsCount && meetsIp) {
                if (exempt) {
                    state = "exempt-multi";
                } else {
                    state = multiIp ? "concurrent-multi-ip" : "concurrent-same-ip";
                    String severity = multiIp ? "critical" : "warning";
                    RemediationAction action = multiIp ? policy.multiIpAction : policy.sameIpAction;
                    List<ConcurrentSessionSnapshot> snaps = clustered.stream()
                            .map(s -> new ConcurrentSessionSnapshot(s.id, s.ip, s.createdAt, s.activityIso, s.ageSeconds,
                                    s.services.stream().map(ServiceRef::serviceName).distinct().toList(), s.current))
                            .toList();
                    List<SessionRef> refs = group.stream()
                            .map(g -> new SessionRef(g.id, g.ip, g.createdAt, Json.str(g.raw, "authenticatorId"), g.current))
                            .toList();
                    RemediationPlan plan = buildRemediationPlan(action, ident, identityName, refs, snaps, authenticators);
                    String ipDetail = clusterIps.isEmpty() ? "with unknown client IP"
                            : clusterIps.size() >= 2
                                    ? "across " + clusterIps.size() + " IPs (" + String.join(", ", clusterIps) + ")"
                                    : "from " + clusterIps.get(0);
                    finding = new ConcurrencyFinding(identityId, identityName, roleAttributes, authMethod, severity,
                            clustered.size(), group.size(), clusterIps, snaps, skewMs, action, plan.steps(),
                            clustered.size() + " active sessions " + ipDetail);
                    findings.add(finding);
                }
            } else if (live.isEmpty() && !group.isEmpty()) {
                state = "stale";
            }
            for (Inter s : group) {
                if (!s.active) {
                    stateById.put(s.id, "stale");
                } else if (!state.equals("single") && !state.equals("stale") && clusteredIds.contains(s.id)) {
                    stateById.put(s.id, state);
                } else {
                    stateById.put(s.id, "single");
                }
            }
            IdentitySummary sum = new IdentitySummary();
            sum.identityId = identityId;
            sum.identityName = identityName;
            sum.isAdmin = isAdmin;
            sum.roleAttributes = roleAttributes;
            sum.authMethod = authMethod;
            sum.isExternalIdentity = isExternal;
            sum.totalSessionCount = group.size();
            sum.liveSessionCount = live.size();
            sum.distinctLiveIps = liveIps;
            sum.allIps = allIps;
            sum.activeServiceIds = new ArrayList<>(svcIds);
            sum.activeServiceNames = new ArrayList<>(svcNames);
            sum.concurrencyState = state;
            sum.finding = finding;
            byIdentity.put(identityId, sum);
        }

        findings.sort(Comparator.<ConcurrencyFinding>comparingInt(f -> "critical".equals(f.severity()) ? 0 : 1)
                .thenComparing(Comparator.comparingInt(ConcurrencyFinding::concurrentSessionCount).reversed())
                .thenComparing(ConcurrencyFinding::identityName));

        Map<String, EnrichedApiSession> apiById = new HashMap<>();
        List<EnrichedApiSession> enriched = new ArrayList<>();
        for (Inter s : all) {
            IdentitySummary sum = byIdentity.get(s.identityId);
            EnrichedApiSession e = new EnrichedApiSession(s.id, s.identityId, sum.identityName, sum.isAdmin,
                    sum.roleAttributes, sum.authMethod, sum.isExternalIdentity, Json.str(s.raw, "authenticatorId"), s.ip,
                    Json.str(s.raw, "ipAddress"), s.createdAt, s.activityIso, s.ageSeconds, s.active, s.current,
                    stateById.getOrDefault(s.id, "single"), s.services);
            apiById.put(e.id(), e);
            enriched.add(e);
        }

        List<ServiceFlowRow> flows = new ArrayList<>();
        for (Map<String, Object> sess : sessions) {
            String apiId = Json.strOr(sess, "apiSessionId", Json.str(sess, "apiSession.id"));
            if (apiId != null && apiId.isEmpty()) {
                apiId = null;
            }
            EnrichedApiSession parent = apiId == null ? null : apiById.get(apiId);
            String identityId = parent != null ? parent.identityId()
                    : Json.strOr(sess, "identityId", "unknown-identity");
            Map<String, Object> ident = identityById.get(identityId);
            IdentitySummary sum = byIdentity.get(identityId);
            String activityAt = parent != null && parent.activityAt() != null ? parent.activityAt()
                    : Json.strOr(sess, "updatedAt", Json.str(sess, "createdAt"));
            Long ms = parseMs(activityAt);
            Long age = ms == null ? null : Math.round(Math.max(0, nowMs - ms) / 1000.0);
            ServiceRef ref = serviceRef(sess);
            if (sum != null && !ref.serviceId().isEmpty() && !sum.activeServiceIds.contains(ref.serviceId())) {
                sum.activeServiceIds.add(ref.serviceId());
                sum.activeServiceNames.add(ref.serviceName());
            } else if (sum == null && ident != null) {
                IdentitySummary n = new IdentitySummary();
                n.identityId = identityId;
                n.identityName = Json.str(ident, "name");
                n.isAdmin = Json.bool(ident, "isAdmin") || Json.bool(ident, "isDefaultAdmin");
                n.roleAttributes = Json.strings(ident, "roleAttributes");
                n.authMethod = inferAuthMethod(ident, authenticators);
                n.isExternalIdentity = Json.str(ident, "externalId") != null && !Json.str(ident, "externalId").isEmpty();
                if (!ref.serviceId().isEmpty()) {
                    n.activeServiceIds.add(ref.serviceId());
                }
                n.activeServiceNames.add(ref.serviceName());
                byIdentity.put(identityId, n);
            }
            flows.add(new ServiceFlowRow(Json.str(sess, "id"), Json.str(sess, "id"), apiId, identityId,
                    parent != null ? parent.identityName() : ident != null ? Json.str(ident, "name") : identityId,
                    parent != null ? parent.roleAttributes()
                            : ident != null ? Json.strings(ident, "roleAttributes") : List.of(),
                    parent != null ? parent.authMethod() : inferAuthMethod(ident, authenticators),
                    parent != null ? parent.ipAddress() : null, ref.serviceId(), ref.serviceName(), ref.type(),
                    ref.routers(), activityAt, age, parent != null && parent.isCurrentSession(),
                    parent != null ? parent.concurrencyState() : sum != null ? sum.concurrencyState : "single",
                    sum != null && sum.finding != null ? sum.finding.severity() : null));
        }
        return new Report(Instant.ofEpochMilli(nowMs).toString(), nowMs, policy, enriched, flows, byIdentity, findings);
    }

    private static List<String> distinctIps(List<Inter> list) {
        return list.stream().map(s -> s.ip).filter(Objects::nonNull).distinct().toList();
    }

    private static ServiceRef serviceRef(Map<String, Object> sess) {
        String serviceId = Json.strOr(sess, "serviceId", Json.strOr(sess, "service.id", ""));
        String serviceName = Json.strOr(sess, "service.name", serviceId.isEmpty() ? "unknown-service" : serviceId);
        List<String> routers = Json.objects(sess, "edgeRouters").stream().map(r -> Json.str(r, "name"))
                .filter(n -> n != null && !n.isEmpty()).toList();
        return new ServiceRef(Json.str(sess, "id"), serviceId, serviceName,
                "Bind".equals(sess.get("type")) ? "Bind" : "Dial", routers, Json.str(sess, "createdAt"));
    }

    // ------------------------------------------------------------------ traffic filtering

    /** Filter for the session tables. concurrency: all | concurrent-any | concurrent-multi-ip | concurrent-same-ip. */
    public static final class TrafficFilter {
        public String search = "";
        public String ipFilter = "";
        /** "all", "__idle__" (API sessions without services) or a service id. */
        public String serviceId = "all";
        public String roleAttribute = "";
        /** "all", "Dial" or "Bind". */
        public String sessionType = "all";
        public String concurrency = "all";
    }

    static boolean matchesConcurrency(String state, String mode) {
        return switch (mode) {
            case "all" -> true;
            case "concurrent-any" -> state.equals("concurrent-multi-ip") || state.equals("concurrent-same-ip");
            case "concurrent-multi-ip" -> state.equals("concurrent-multi-ip");
            default -> state.equals("concurrent-same-ip");
        };
    }

    public static List<ServiceFlowRow> filterServiceFlows(List<ServiceFlowRow> rows, TrafficFilter f) {
        String q = f.search.trim().toLowerCase().replaceFirst("^[#@]", "");
        String attr = f.roleAttribute.trim().replaceFirst("^#", "");
        return rows.stream().filter(r -> {
            if (!matchesConcurrency(r.concurrencyState(), f.concurrency)) {
                return false;
            }
            if (!f.sessionType.equals("all") && !r.type().equals(f.sessionType)) {
                return false;
            }
            if (f.serviceId.equals("__idle__")) {
                return false;
            }
            if (!f.serviceId.isEmpty() && !f.serviceId.equals("all") && !r.serviceId().equals(f.serviceId)) {
                return false;
            }
            if (!attr.isEmpty() && !r.roleAttributes().contains(attr)) {
                return false;
            }
            if (!IpFilter.matches(r.ipAddress(), f.ipFilter)) {
                return false;
            }
            if (!q.isEmpty()) {
                List<String> hay = new ArrayList<>(List.of(r.sessionId(), Objects.requireNonNullElse(r.apiSessionId(), ""),
                        r.identityName(), Objects.requireNonNullElse(r.ipAddress(), ""), r.serviceName(), r.type()));
                hay.addAll(r.roleAttributes());
                hay.addAll(r.routers());
                return String.join(" ", hay).toLowerCase().contains(q);
            }
            return true;
        }).toList();
    }

    public static List<EnrichedApiSession> filterApiSessions(List<EnrichedApiSession> rows, TrafficFilter f) {
        String q = f.search.trim().toLowerCase().replaceFirst("^[#@]", "");
        String attr = f.roleAttribute.trim().replaceFirst("^#", "");
        return rows.stream().filter(r -> {
            if (!matchesConcurrency(r.concurrencyState(), f.concurrency)) {
                return false;
            }
            if (!f.sessionType.equals("all") && r.services().stream().noneMatch(s -> s.type().equals(f.sessionType))) {
                return false;
            }
            if (f.serviceId.equals("__idle__")) {
                if (!r.services().isEmpty()) {
                    return false;
                }
            } else if (!f.serviceId.isEmpty() && !f.serviceId.equals("all")
                    && r.services().stream().noneMatch(s -> s.serviceId().equals(f.serviceId))) {
                return false;
            }
            if (!attr.isEmpty() && !r.roleAttributes().contains(attr)) {
                return false;
            }
            if (!IpFilter.matches(r.ipAddress(), f.ipFilter)) {
                return false;
            }
            if (!q.isEmpty()) {
                List<String> hay = new ArrayList<>(List.of(r.id(), r.identityName(),
                        Objects.requireNonNullElse(r.ipAddress(), ""), r.authMethod()));
                hay.addAll(r.roleAttributes());
                for (ServiceRef s : r.services()) {
                    hay.add(s.serviceName());
                    hay.add(s.type());
                    hay.addAll(s.routers());
                }
                return String.join(" ", hay).toLowerCase().contains(q);
            }
            return true;
        }).toList();
    }
}
