package io.moscait.bpc.canvas;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.function.Supplier;
import java.util.regex.Pattern;

import io.moscait.bpc.canvas.AcModel.AcErPolicy;
import io.moscait.bpc.canvas.AcModel.AcIdentity;
import io.moscait.bpc.canvas.AcModel.AcKind;
import io.moscait.bpc.canvas.AcModel.AcNewConfig;
import io.moscait.bpc.canvas.AcModel.AcNewIdentity;
import io.moscait.bpc.canvas.AcModel.AcNewService;
import io.moscait.bpc.canvas.AcModel.AcOp;
import io.moscait.bpc.canvas.AcModel.AcSerp;
import io.moscait.bpc.canvas.AcModel.AcService;
import io.moscait.bpc.canvas.AcModel.AcServicePolicy;
import io.moscait.bpc.canvas.AcModel.AddAttr;
import io.moscait.bpc.canvas.AcModel.CreateConfig;
import io.moscait.bpc.canvas.AcModel.CreateErPolicy;
import io.moscait.bpc.canvas.AcModel.CreateIdentity;
import io.moscait.bpc.canvas.AcModel.CreatePolicy;
import io.moscait.bpc.canvas.AcModel.CreateSerp;
import io.moscait.bpc.canvas.AcModel.CreateService;
import io.moscait.bpc.ziti.Json;

/**
 * Set-up wizard: one service, the identity that hosts it, the users who may reach it, and the
 * policies between them, named the way OpenZiti deployments usually name them.
 */
public final class WizardLogic {

    private WizardLogic() {
    }

    public record Template(String id, String label, String group, String slug, int port, List<String> protocols,
            List<String> users, String interceptTld, String note) {
    }

    public static final List<Template> TEMPLATES = List.of(
            new Template("ssh", "SSH (remote shell)", "Remote access", "ssh", 22, List.of("tcp"),
                    List.of("it-admins", "developers", "sre"), null, null),
            new Template("rdp", "Remote Desktop (RDP)", "Remote access", "rdp", 3389, List.of("tcp"),
                    List.of("it-admins", "support", "employees"), null, null),
            new Template("vnc", "VNC screen sharing", "Remote access", "vnc", 5900, List.of("tcp"),
                    List.of("support", "it-admins"), null, null),
            new Template("ollama", "Ollama (LLM API)", "Remote access", "ollama", 11434, List.of("tcp"),
                    List.of("developers", "employees", "sre"), "ziti.internal",
                    "Uses .ziti.internal so Ollama accepts the Host header on 127.0.0.1:11434 without extra host config."),
            new Template("https", "Internal web app (HTTPS)", "Web", "https", 443, List.of("tcp"),
                    List.of("employees", "developers"), null, null),
            new Template("http", "Internal web app (HTTP)", "Web", "http", 80, List.of("tcp"),
                    List.of("employees", "developers"), null,
                    "Traffic is encrypted end to end over Ziti even though the app speaks plain HTTP."),
            new Template("api", "Internal API (HTTPS, 8443)", "Web", "api", 8443, List.of("tcp"),
                    List.of("developers", "sre"), null, null),
            new Template("grafana", "Grafana / dashboards", "Web", "grafana", 3000, List.of("tcp"),
                    List.of("sre", "developers"), null, null),
            new Template("jenkins", "Jenkins / CI server", "Web", "jenkins", 8080, List.of("tcp"),
                    List.of("developers", "sre"), null, null),
            new Template("postgres", "PostgreSQL", "Databases", "postgres", 5432, List.of("tcp"),
                    List.of("dbas", "developers"), null, null),
            new Template("mysql", "MySQL / MariaDB", "Databases", "mysql", 3306, List.of("tcp"),
                    List.of("dbas", "developers"), null, null),
            new Template("mssql", "Microsoft SQL Server", "Databases", "mssql", 1433, List.of("tcp"),
                    List.of("dbas", "developers"), null, null),
            new Template("redis", "Redis", "Databases", "redis", 6379, List.of("tcp"), List.of("developers", "sre"),
                    null, null),
            new Template("smb", "Windows file share (SMB)", "Files and infrastructure", "smb", 445, List.of("tcp"),
                    List.of("employees", "finance", "hr"), null, null),
            new Template("k8s", "Kubernetes API", "Files and infrastructure", "k8s-api", 6443, List.of("tcp"),
                    List.of("platform-engineers", "sre"), null, null),
            new Template("custom", "Something else (choose the port)", "Other", "app", 8080, List.of("tcp"),
                    List.of("employees"), null, null));

    public record UserGroup(String attr, String label) {
    }

    public static final List<UserGroup> USER_GROUPS = List.of(new UserGroup("employees", "All employees"),
            new UserGroup("it-admins", "IT administrators"), new UserGroup("developers", "Developers"),
            new UserGroup("sre", "SRE / operations"), new UserGroup("platform-engineers", "Platform engineers"),
            new UserGroup("dbas", "Database administrators"), new UserGroup("support", "Support / help desk"),
            new UserGroup("finance", "Finance"), new UserGroup("hr", "HR"), new UserGroup("sales", "Sales"),
            new UserGroup("contractors", "Contractors"), new UserGroup("executives", "Executives"));

    /** Mutable wizard state, edited by the dialog. */
    public static final class Input {
        public String templateId = "ssh";
        public String system = "";
        public String serviceName;
        public String interceptHost;
        public int interceptPort;
        public String hostAddress;
        public int hostPort;
        public List<String> protocols = new ArrayList<>();
        public String hostMode = "new";
        public String hostId = "";
        public String hostName;
        public String hostsAttr;
        public String usersAttr;
        public String userMode = "new";
        public List<String> userIds = new ArrayList<>();
        public String newUserName = "";
        public boolean reuseExisting;

        /** Applies the template's suggestions for this system name. */
        public void suggest() {
            Template t = template(templateId);
            String sys = slugify(system);
            if (sys.isEmpty()) {
                sys = "app-server";
            }
            String suffix = "-" + t.slug();
            serviceName = sys.endsWith(suffix) ? sys : sys + suffix;
            interceptHost = sys + "." + (t.interceptTld() == null ? "ziti" : t.interceptTld());
            interceptPort = t.port();
            hostAddress = "127.0.0.1";
            hostPort = t.port();
            protocols = new ArrayList<>(t.protocols());
            hostName = sys;
            hostsAttr = serviceName + "-hosts";
            usersAttr = t.users().getFirst();
        }
    }

    public static Input blank(String templateId, String system) {
        Input w = new Input();
        w.templateId = templateId;
        w.system = system;
        w.suggest();
        return w;
    }

    public record Conflict(String kind, String label, String name, String id, String field) {
    }

    public record Check(String field, String message) {
    }

    public record Item(String what, String name, String detail, boolean existing) {
    }

    public record Plan(List<AcOp> ops, List<Item> items, String title, String summary, List<String> next,
            List<String> created, List<String> updated) {
    }

    private static final Pattern VALID_NAME = Pattern.compile("^[a-z0-9][a-z0-9._-]*$");

    public static String slugify(String s) {
        return s.trim().toLowerCase().replaceFirst("^[#@]", "").replaceAll("[^a-z0-9.]+", "-").replaceAll("^-+|-+$", "");
    }

    public static Template template(String id) {
        return TEMPLATES.stream().filter(t -> t.id().equals(id)).findFirst().orElse(TEMPLATES.getLast());
    }

    private static boolean validPort(int p) {
        return p >= 1 && p <= 65535;
    }

    private static boolean validName(String s) {
        return s != null && VALID_NAME.matcher(s).matches();
    }

    private static <T> T byName(List<T> list, java.util.function.Function<T, String> name, String n) {
        return list.stream().filter(x -> name.apply(x).equalsIgnoreCase(n)).findFirst().orElse(null);
    }

    private static List<Conflict> serviceConflicts(AcModel m, String serviceName) {
        String name = serviceName == null ? "" : serviceName.trim();
        List<Conflict> out = new ArrayList<>();
        if (name.isEmpty()) {
            return out;
        }
        AcService svc = byName(m.services, s -> s.name, name);
        if (svc != null) {
            out.add(new Conflict("service", "Service", svc.name, svc.id, "serviceName"));
        }
        var ic = byName(m.configs, c -> c.name, name + ".intercept.v1");
        if (ic != null) {
            out.add(new Conflict("config", "Intercept Config", ic.name, ic.id, "serviceName"));
        }
        var hc = byName(m.configs, c -> c.name, name + ".host.v1");
        if (hc != null) {
            out.add(new Conflict("config", "Host Config", hc.name, hc.id, "serviceName"));
        }
        var bind = byName(m.servicePolicies, p -> p.name, name + "-bind");
        if (bind != null) {
            out.add(new Conflict("policy", "Bind Service Policy", bind.name, bind.id, "serviceName"));
        }
        var dial = byName(m.servicePolicies, p -> p.name, name + "-dial");
        if (dial != null) {
            out.add(new Conflict("policy", "Dial Service Policy", dial.name, dial.id, "serviceName"));
        }
        var serp = byName(m.serps, p -> p.name, name + "-routers");
        if (serp != null) {
            out.add(new Conflict("router-policy", "Service Router Policy", serp.name, serp.id, "serviceName"));
        }
        var erp = byName(m.erPolicies, p -> p.name, name + "-identities-routers");
        if (erp != null) {
            out.add(new Conflict("router-policy", "Edge Router Policy", erp.name, erp.id, "serviceName"));
        }
        return out;
    }

    public static List<Conflict> detectConflicts(AcModel m, Input w) {
        List<Conflict> out = new ArrayList<>(serviceConflicts(m, w.serviceName));
        if (w.hostMode.equals("new") && w.hostName != null && !w.hostName.isBlank()) {
            AcIdentity h = byName(m.identities, i -> i.name, w.hostName.trim());
            if (h != null) {
                out.add(new Conflict("identity", "Identity", h.name, h.id, "hostName"));
            }
        }
        if (w.userMode.equals("new") && !w.newUserName.isBlank()) {
            AcIdentity u = byName(m.identities, i -> i.name, w.newUserName.trim());
            if (u != null) {
                out.add(new Conflict("identity", "Identity", u.name, u.id, "newUserName"));
            }
        }
        return out;
    }

    public static String suggestAvailableServiceName(AcModel m, String base) {
        String clean = slugify(base);
        if (clean.isEmpty()) {
            clean = "app";
        }
        if (serviceConflicts(m, clean).isEmpty()) {
            return clean;
        }
        for (int i = 2; i < 1000; i++) {
            String c = clean + "-" + i;
            if (serviceConflicts(m, c).isEmpty()) {
                return c;
            }
        }
        return clean + "-" + System.currentTimeMillis();
    }

    public static List<Check> validate(AcModel m, Input w) {
        List<Check> out = new ArrayList<>();
        if (w.system.isBlank()) {
            out.add(new Check("system", "Name the system or machine it runs on."));
        }
        if (!validName(w.serviceName)) {
            out.add(new Check("serviceName", "Use lowercase letters, digits, dots and dashes."));
        } else if (!w.reuseExisting) {
            List<Conflict> c = serviceConflicts(m, w.serviceName);
            if (!c.isEmpty()) {
                out.add(new Check("serviceName", "Already exists on controller: "
                        + String.join(", ", c.stream().map(x -> x.label() + " \"" + x.name() + "\"").toList())
                        + ". Choose a different name or click \"Update existing resources\"."));
            }
        }
        if (w.interceptHost == null || w.interceptHost.isBlank() || w.interceptHost.matches(".*\\s.*")) {
            out.add(new Check("interceptHost", "Enter a hostname or IP address users will connect to."));
        }
        if (!validPort(w.interceptPort)) {
            out.add(new Check("interceptPort", "Ports are 1 to 65535."));
        }
        if (w.hostAddress == null || w.hostAddress.isBlank() || w.hostAddress.matches(".*\\s.*")) {
            out.add(new Check("hostAddress", "Enter the address the server listens on."));
        }
        if (!validPort(w.hostPort)) {
            out.add(new Check("hostPort", "Ports are 1 to 65535."));
        }
        if (w.hostMode.equals("existing") && m.identities.stream().noneMatch(i -> i.id.equals(w.hostId))) {
            out.add(new Check("hostId", "Choose the identity that hosts it."));
        }
        if (w.hostMode.equals("new")) {
            if (!validName(w.hostName)) {
                out.add(new Check("hostName", "Use lowercase letters, digits, dots and dashes."));
            } else if (m.identities.stream().anyMatch(i -> i.name.equalsIgnoreCase(w.hostName))) {
                out.add(new Check("hostName", "An identity named " + w.hostName
                        + " already exists. Choose “Existing identity” to use it."));
            }
        }
        if (!validName(w.hostsAttr)) {
            out.add(new Check("hostsAttr", "Use lowercase letters, digits, dots and dashes."));
        }
        if (!validName(w.usersAttr)) {
            out.add(new Check("usersAttr", "Choose or type a user group."));
        }
        if (w.userMode.equals("new")) {
            if (w.newUserName.isEmpty()) {
                out.add(new Check("newUserName",
                        "Name the user's device, e.g. jdoe-laptop, or choose “Existing identities”."));
            } else if (!validName(w.newUserName)) {
                out.add(new Check("newUserName", "Use lowercase letters, digits, dots and dashes."));
            } else if (m.identities.stream().anyMatch(i -> i.name.equalsIgnoreCase(w.newUserName))) {
                out.add(new Check("newUserName", "An identity named " + w.newUserName
                        + " already exists. Choose “Existing identities” to use it."));
            }
        } else {
            boolean inGroup = m.identities.stream().anyMatch(i -> !i.isAdmin && i.attrs.contains(w.usersAttr));
            if (w.userIds.isEmpty() && !inGroup) {
                out.add(new Check("userIds", "Nobody has #" + w.usersAttr
                        + " yet, so nobody could use it. Pick at least one identity, or create a new user device."));
            }
        }
        return out;
    }

    private static List<String> union(List<String> a, List<String> b) {
        LinkedHashSet<String> s = new LinkedHashSet<>(a);
        s.addAll(b);
        return new ArrayList<>(s);
    }

    private static List<String> hashed(List<String> attrs) {
        return attrs.stream().map(a -> "#" + a).toList();
    }

    public static Plan plan(AcModel m, Input w, Supplier<String> newId) {
        List<AcOp> ops = new ArrayList<>();
        List<Item> items = new ArrayList<>();
        String svc = w.serviceName;
        boolean reuse = w.reuseExisting;

        var existingIntercept = reuse ? byName(m.configs, c -> c.name, svc + ".intercept.v1") : null;
        var existingHostCfg = reuse ? byName(m.configs, c -> c.name, svc + ".host.v1") : null;
        AcNewConfig intercept = new AcNewConfig(newId.get(), svc + ".intercept.v1", "intercept.v1",
                Json.map("protocols", new ArrayList<>(w.protocols), "addresses", List.of(w.interceptHost.trim()),
                        "portRanges", List.of(Json.map("low", w.interceptPort, "high", w.interceptPort))));
        intercept.existingId = existingIntercept == null ? null : existingIntercept.id;
        AcNewConfig host = new AcNewConfig(newId.get(), svc + ".host.v1", "host.v1",
                Json.map("protocol", w.protocols.getFirst(), "address", w.hostAddress.trim(), "port", w.hostPort));
        host.existingId = existingHostCfg == null ? null : existingHostCfg.id;
        ops.add(new CreateConfig(intercept));
        ops.add(new CreateConfig(host));
        items.add(new Item("Config (intercept.v1)", intercept.name,
                "users connect to " + w.interceptHost + ":" + w.interceptPort, existingIntercept != null));
        items.add(new Item("Config (host.v1)", host.name,
                "forwarded to " + w.hostAddress + ":" + w.hostPort + " on the hosting identity", existingHostCfg != null));

        Template t = template(w.templateId);
        AcService existingSvc = reuse ? byName(m.services, s -> s.name, svc) : null;
        List<String> svcAttrs = existingSvc != null ? union(existingSvc.attrs, List.of(svc)) : List.of(svc);
        String svcId = newId.get();
        AcNewService ns = new AcNewService(svcId, svc, svcAttrs, List.of(intercept.id, host.id), true, "smartrouting");
        ns.existingId = existingSvc == null ? null : existingSvc.id;
        ops.add(new CreateService(ns));
        items.add(new Item("Service", svc, "role attributes " + String.join(", ", hashed(svcAttrs)), existingSvc != null));

        boolean sameNew = w.hostMode.equals("new") && w.userMode.equals("new") && w.newUserName.equals(w.hostName);
        String hostLabel;
        if (w.hostMode.equals("new")) {
            List<String> attrs = sameNew ? union(List.of(w.hostsAttr), List.of(w.usersAttr)) : List.of(w.hostsAttr);
            ops.add(new CreateIdentity(new AcNewIdentity(newId.get(), w.hostName, attrs)));
            items.add(new Item(sameNew ? "Identity (hosts & uses)" : "Identity (hosts it)", w.hostName,
                    sameNew ? "role attributes " + String.join(", ", hashed(attrs)) + "; enroll it on the server"
                            : "role attribute #" + w.hostsAttr + "; enroll it on the server",
                    false));
            hostLabel = w.hostName;
        } else {
            AcIdentity h = m.identities.stream().filter(i -> i.id.equals(w.hostId)).findFirst().orElseThrow();
            if (!h.attrs.contains(w.hostsAttr)) {
                ops.add(new AddAttr(AcKind.IDENTITY, h.id, w.hostsAttr));
            }
            items.add(new Item("Identity (hosts it)", h.name, "gets role attribute #" + w.hostsAttr, true));
            hostLabel = h.name;
        }

        List<String> users = new ArrayList<>();
        if (w.userMode.equals("existing")) {
            for (String id : w.userIds) {
                AcIdentity u = m.identities.stream().filter(i -> i.id.equals(id)).findFirst().orElse(null);
                if (u == null) {
                    continue;
                }
                users.add(u.name);
                boolean addedByHost = w.hostMode.equals("existing") && id.equals(w.hostId) && w.hostsAttr.equals(w.usersAttr);
                if (!u.attrs.contains(w.usersAttr) && !addedByHost) {
                    ops.add(new AddAttr(AcKind.IDENTITY, id, w.usersAttr));
                }
                items.add(new Item("Identity (user)", u.name, "gets role attribute #" + w.usersAttr, true));
            }
        }
        if (sameNew) {
            users.add(w.newUserName);
        } else if (w.userMode.equals("new") && !w.newUserName.isEmpty()) {
            ops.add(new CreateIdentity(new AcNewIdentity(newId.get(), w.newUserName, List.of(w.usersAttr))));
            items.add(new Item("Identity (user)", w.newUserName,
                    "role attribute #" + w.usersAttr + "; enroll it on the user's device", false));
            users.add(w.newUserName);
        }
        List<String> already = m.identities.stream()
                .filter(i -> !i.isAdmin && i.attrs.contains(w.usersAttr) && !users.contains(i.name)).map(i -> i.name)
                .toList();

        ops.add(new CreatePolicy(policy(m, reuse, svc + "-bind", "Bind", "#" + w.hostsAttr, "#" + svc, newId)));
        items.add(new Item("Bind service policy", svc + "-bind", "#" + w.hostsAttr + " hosts #" + svc,
                reuse && byName(m.servicePolicies, p -> p.name, svc + "-bind") != null));
        ops.add(new CreatePolicy(policy(m, reuse, svc + "-dial", "Dial", "#" + w.usersAttr, "#" + svc, newId)));
        items.add(new Item("Dial service policy", svc + "-dial", "#" + w.usersAttr + " may use #" + svc,
                reuse && byName(m.servicePolicies, p -> p.name, svc + "-dial") != null));

        AcModel after = AccessLogic.applyOps(m.copy(), ops);
        String svcAfterId = existingSvc != null ? existingSvc.id : svcId;
        AcService svcAfter = after.services.stream().filter(s -> s.id.equals(svcAfterId)).findFirst().orElse(null);
        if (!after.routers.isEmpty() && svcAfter != null && AccessLogic.serviceRouters(after, svcAfter).isEmpty()) {
            AcSerp existing = reuse ? byName(m.serps, p -> p.name, svc + "-routers") : null;
            AcSerp p = new AcSerp(newId.get(), svc + "-routers", existing == null ? "AnyOf" : existing.semantic,
                    existing == null ? List.of("#" + svc) : union(existing.serviceRoles, List.of("#" + svc)),
                    existing == null ? List.of("#all") : union(existing.routerRoles, List.of("#all")));
            p.existingId = existing == null ? null : existing.id;
            ops.add(new CreateSerp(p));
            items.add(new Item("Service Router Policy", svc + "-routers", "#" + svc + " may use all routers", existing != null));
        }
        List<AcIdentity> needRoutes = after.identities.stream()
                .filter(i -> (i.attrs.contains(w.hostsAttr) || i.attrs.contains(w.usersAttr))
                        && AccessLogic.identityRouters(after, i).isEmpty())
                .toList();
        if (!after.routers.isEmpty() && !needRoutes.isEmpty()) {
            List<String> roles = new ArrayList<>(new LinkedHashSet<>(needRoutes.stream()
                    .map(i -> i.attrs.contains(w.hostsAttr) ? "#" + w.hostsAttr : "#" + w.usersAttr).toList()));
            AcErPolicy existing = reuse ? byName(m.erPolicies, p -> p.name, svc + "-identities-routers") : null;
            AcErPolicy p = new AcErPolicy(newId.get(), svc + "-identities-routers",
                    existing == null ? "AnyOf" : existing.semantic,
                    existing == null ? roles : union(existing.identityRoles, roles),
                    existing == null ? List.of("#all") : union(existing.routerRoles, List.of("#all")));
            p.existingId = existing == null ? null : existing.id;
            ops.add(new CreateErPolicy(p));
            items.add(new Item("Router Policy", svc + "-identities-routers", String.join(", ", roles) + " may use all routers",
                    existing != null));
        }

        List<String> next = new ArrayList<>();
        if (w.hostMode.equals("new")) {
            next.add("On the server, enroll " + w.hostName + " with its one-time token (Identities → " + w.hostName
                    + " → Token): sudo ziti-edge-tunnel enroll --jwt " + w.hostName + ".jwt --identity /opt/openziti/etc/identities/"
                    + w.hostName + ".json, then restart ziti-edge-tunnel.");
        }
        if (w.userMode.equals("new") && !w.newUserName.isEmpty() && !sameNew) {
            next.add("Enroll " + w.newUserName + " in Ziti Desktop Edge (or another tunneler) on that user's device with its token.");
        }
        next.add("Users connect to " + w.interceptHost + ":" + w.interceptPort + " with their usual client; Ziti carries it to "
                + w.hostAddress + ":" + w.hostPort + " on " + hostLabel + ".");

        List<String> who = new ArrayList<>(users);
        who.addAll(already);
        List<String> created = ops.stream().filter(o -> o instanceof CreateIdentity).map(o -> ((CreateIdentity) o).identity().name())
                .toList();
        List<String> updated = new ArrayList<>(new LinkedHashSet<>(ops.stream().filter(o -> o instanceof AddAttr)
                .map(o -> m.identities.stream().filter(i -> i.id.equals(((AddAttr) o).id())).map(i -> i.name).findFirst()
                        .orElse(null))
                .filter(java.util.Objects::nonNull).toList()));
        String whoText = who.isEmpty() ? " (nobody has it yet)"
                : " (" + String.join(", ", who.subList(0, Math.min(3, who.size())))
                        + (who.size() > 3 ? " and " + (who.size() - 3) + " more" : "") + ")";
        return new Plan(ops, items, "Set up " + svc + " for #" + w.usersAttr,
                t.label() + " on " + hostLabel + ", reachable at " + w.interceptHost + ":" + w.interceptPort + " by #"
                        + w.usersAttr + whoText + ".",
                next, created, updated);
    }

    private static AcServicePolicy policy(AcModel m, boolean reuse, String name, String type, String identityRole,
            String serviceRole, Supplier<String> newId) {
        AcServicePolicy existing = reuse ? byName(m.servicePolicies, p -> p.name, name) : null;
        AcServicePolicy p = new AcServicePolicy(newId.get(), name, type, existing == null ? "AnyOf" : existing.semantic,
                existing == null ? List.of(identityRole) : union(existing.identityRoles, List.of(identityRole)),
                existing == null ? List.of(serviceRole) : union(existing.serviceRoles, List.of(serviceRole)),
                existing == null ? List.of() : existing.posture);
        p.existingId = existing == null ? null : existing.id;
        return p;
    }
}
