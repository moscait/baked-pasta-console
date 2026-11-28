package io.moscait.bpc.canvas;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.ziti.Json;

/**
 * The Access Canvas view of a network: identities, services and routers with their role
 * attributes, and the four policy families that connect them.
 *
 * <p>Role strings follow the Edge Management API: "#attr" selects by role attribute, "@id"
 * selects one entity by id, and "#all" selects everything.
 */
public final class AcModel {

    public List<AcIdentity> identities = new ArrayList<>();
    public List<AcService> services = new ArrayList<>();
    public List<AcRouter> routers = new ArrayList<>();
    public List<AcServicePolicy> servicePolicies = new ArrayList<>();
    public List<AcErPolicy> erPolicies = new ArrayList<>();
    public List<AcSerp> serps = new ArrayList<>();
    public List<AcConfig> configs = new ArrayList<>();

    public AcModel copy() {
        AcModel m = new AcModel();
        identities.forEach(x -> m.identities.add(x.copy()));
        services.forEach(x -> m.services.add(x.copy()));
        routers.forEach(x -> m.routers.add(x.copy()));
        servicePolicies.forEach(x -> m.servicePolicies.add(x.copy()));
        erPolicies.forEach(x -> m.erPolicies.add(x.copy()));
        serps.forEach(x -> m.serps.add(x.copy()));
        configs.forEach(x -> m.configs.add(x.copy()));
        return m;
    }

    public List<? extends AcEntity> entitiesOf(AcKind kind) {
        return switch (kind) {
            case IDENTITY -> identities;
            case SERVICE -> services;
            case ROUTER -> routers;
        };
    }

    // ------------------------------------------------------------------ kinds

    public enum AcKind {
        IDENTITY("identity", "identities", "identities"),
        SERVICE("service", "services", "services"),
        ROUTER("router", "routers", "edge-routers");

        public final String one;
        public final String many;
        public final String api;

        AcKind(String one, String many, String api) {
            this.one = one;
            this.many = many;
            this.api = api;
        }

        public String id() {
            return one;
        }

        public String title() {
            return Character.toUpperCase(one.charAt(0)) + one.substring(1);
        }

        public static AcKind of(String id) {
            for (AcKind k : values()) {
                if (k.one.equals(id)) {
                    return k;
                }
            }
            throw new IllegalArgumentException("Unknown kind " + id);
        }
    }

    // ------------------------------------------------------------------ entities

    public static class AcEntity {
        public String id;
        public String name;
        public List<String> attrs = new ArrayList<>();

        AcEntity() {
        }

        AcEntity(String id, String name, List<String> attrs) {
            this.id = id;
            this.name = name;
            this.attrs = new ArrayList<>(attrs);
        }
    }

    public record AcConcurrency(String severity, int concurrentSessionCount, List<String> distinctIps, String summary) {
    }

    public static final class AcIdentity extends AcEntity {
        public boolean enrolled;
        public boolean online;
        public boolean isAdmin;
        public String externalId;
        public List<String> sessionIps;
        public Integer liveSessionCount;
        public List<String> activeServiceIds;
        public AcConcurrency concurrency;

        public AcIdentity(String id, String name, List<String> attrs) {
            super(id, name, attrs);
        }

        AcIdentity copy() {
            AcIdentity c = new AcIdentity(id, name, attrs);
            c.enrolled = enrolled;
            c.online = online;
            c.isAdmin = isAdmin;
            c.externalId = externalId;
            c.sessionIps = sessionIps == null ? null : new ArrayList<>(sessionIps);
            c.liveSessionCount = liveSessionCount;
            c.activeServiceIds = activeServiceIds == null ? null : new ArrayList<>(activeServiceIds);
            c.concurrency = concurrency;
            return c;
        }
    }

    public static final class AcService extends AcEntity {
        public List<String> configs = new ArrayList<>();
        public boolean encryptionRequired = true;
        public String terminatorStrategy = "smartrouting";

        public AcService(String id, String name, List<String> attrs) {
            super(id, name, attrs);
        }

        AcService copy() {
            AcService c = new AcService(id, name, attrs);
            c.configs = new ArrayList<>(configs);
            c.encryptionRequired = encryptionRequired;
            c.terminatorStrategy = terminatorStrategy;
            return c;
        }
    }

    public static final class AcRouter extends AcEntity {
        public boolean online;

        public AcRouter(String id, String name, List<String> attrs, boolean online) {
            super(id, name, attrs);
            this.online = online;
        }

        AcRouter copy() {
            return new AcRouter(id, name, attrs, online);
        }
    }

    public static final class AcConfig {
        public String id;
        public String name;
        public String type;
        public Map<String, Object> data;

        public AcConfig(String id, String name, String type, Map<String, Object> data) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.data = data;
        }

        AcConfig copy() {
            return new AcConfig(id, name, type, data == null ? null : Json.copy(data));
        }
    }

    // ------------------------------------------------------------------ policies

    public static final class AcServicePolicy {
        public String id;
        public String name;
        /** "Dial" or "Bind". */
        public String type;
        public String semantic = "AnyOf";
        public List<String> identityRoles = new ArrayList<>();
        public List<String> serviceRoles = new ArrayList<>();
        public List<String> posture = new ArrayList<>();
        public String existingId;

        public AcServicePolicy(String id, String name, String type, String semantic, List<String> identityRoles,
                List<String> serviceRoles, List<String> posture) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.semantic = semantic;
            this.identityRoles = new ArrayList<>(identityRoles);
            this.serviceRoles = new ArrayList<>(serviceRoles);
            this.posture = new ArrayList<>(posture);
        }

        public boolean isDial() {
            return "Dial".equals(type);
        }

        public AcServicePolicy copy() {
            AcServicePolicy c = new AcServicePolicy(id, name, type, semantic, identityRoles, serviceRoles, posture);
            c.existingId = existingId;
            return c;
        }
    }

    public static final class AcErPolicy {
        public String id;
        public String name;
        public String semantic = "AnyOf";
        public List<String> identityRoles = new ArrayList<>();
        public List<String> routerRoles = new ArrayList<>();
        public String existingId;

        public AcErPolicy(String id, String name, String semantic, List<String> identityRoles, List<String> routerRoles) {
            this.id = id;
            this.name = name;
            this.semantic = semantic;
            this.identityRoles = new ArrayList<>(identityRoles);
            this.routerRoles = new ArrayList<>(routerRoles);
        }

        public AcErPolicy copy() {
            AcErPolicy c = new AcErPolicy(id, name, semantic, identityRoles, routerRoles);
            c.existingId = existingId;
            return c;
        }
    }

    public static final class AcSerp {
        public String id;
        public String name;
        public String semantic = "AnyOf";
        public List<String> serviceRoles = new ArrayList<>();
        public List<String> routerRoles = new ArrayList<>();
        public String existingId;

        public AcSerp(String id, String name, String semantic, List<String> serviceRoles, List<String> routerRoles) {
            this.id = id;
            this.name = name;
            this.semantic = semantic;
            this.serviceRoles = new ArrayList<>(serviceRoles);
            this.routerRoles = new ArrayList<>(routerRoles);
        }

        public AcSerp copy() {
            AcSerp c = new AcSerp(id, name, semantic, serviceRoles, routerRoles);
            c.existingId = existingId;
            return c;
        }
    }

    // ------------------------------------------------------------------ new entities

    public record AcNewIdentity(String id, String name, List<String> attrs) {
    }

    public static final class AcNewService {
        public String id;
        public String name;
        public List<String> attrs;
        public List<String> configs;
        public boolean encryptionRequired;
        public String terminatorStrategy;
        public String existingId;

        public AcNewService(String id, String name, List<String> attrs, List<String> configs,
                boolean encryptionRequired, String terminatorStrategy) {
            this.id = id;
            this.name = name;
            this.attrs = new ArrayList<>(attrs);
            this.configs = new ArrayList<>(configs);
            this.encryptionRequired = encryptionRequired;
            this.terminatorStrategy = terminatorStrategy;
        }
    }

    /** A service configuration (intercept.v1 or host.v1) created or updated alongside a service. */
    public static final class AcNewConfig {
        public String id;
        public String name;
        public String type;
        public Map<String, Object> data;
        public String existingId;

        public AcNewConfig(String id, String name, String type, Map<String, Object> data) {
            this.id = id;
            this.name = name;
            this.type = type;
            this.data = data;
        }
    }

    // ------------------------------------------------------------------ operations

    /** One change to the network, applied in order by {@code ZitiService.applyCanvasOps}. */
    public sealed interface AcOp {
    }

    public record AddAttr(AcKind kind, String id, String attr) implements AcOp {
    }

    public record RemoveAttr(AcKind kind, String id, String attr) implements AcOp {
    }

    public record AddIdentityRole(String policy, String role) implements AcOp {
    }

    public record CreatePolicy(AcServicePolicy policy) implements AcOp {
    }

    public record CreateErPolicy(AcErPolicy policy) implements AcOp {
    }

    public record CreateSerp(AcSerp policy) implements AcOp {
    }

    public record CreateConfig(AcNewConfig config) implements AcOp {
    }

    public record CreateIdentity(AcNewIdentity identity) implements AcOp {
    }

    public record CreateService(AcNewService service) implements AcOp {
    }

    // ------------------------------------------------------------------ layout

    /** Canvas positions, kept per controller. Keys are canvas node keys. */
    public static final class AcLayout {
        public Map<String, int[]> nodes = new LinkedHashMap<>();
        /** Groups created on the canvas that may not have members yet, as "kind:attr". */
        public List<String> groups = new ArrayList<>();

        public AcLayout copy() {
            AcLayout l = new AcLayout();
            nodes.forEach((k, v) -> l.nodes.put(k, new int[] { v[0], v[1] }));
            l.groups = new ArrayList<>(groups);
            return l;
        }

        public boolean sameAs(AcLayout b) {
            if (nodes.size() != b.nodes.size()) {
                return false;
            }
            for (var e : nodes.entrySet()) {
                int[] o = b.nodes.get(e.getKey());
                if (o == null || o[0] != e.getValue()[0] || o[1] != e.getValue()[1]) {
                    return false;
                }
            }
            return new java.util.TreeSet<>(groups).equals(new java.util.TreeSet<>(b.groups));
        }
    }
}
