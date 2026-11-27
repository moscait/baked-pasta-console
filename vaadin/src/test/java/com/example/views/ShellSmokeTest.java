package com.example.views;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.example.ziti.ZitiService;
import com.vaadin.browserless.SpringBrowserlessTest;
import com.vaadin.flow.component.notification.Notification;

/** Renders the shell and pages against the Demo Sandbox (no controller is reachable in tests). */
@SpringBootTest(properties = "ziti.controller-url=https://127.0.0.1:9")
class ShellSmokeTest extends SpringBrowserlessTest {

    @Autowired
    ObjectProvider<ZitiService> ziti;

    @Test
    void firstVisitWithoutController_opensDemoSandboxDashboard() {
        DashboardView view = navigate(DashboardView.class);
        assertTrue(ziti.getObject().isDemoMode());
        assertTrue(view.getElement().getOuterHTML().contains("Zero-Trust Overlay Network Overview"));
        assertTrue(view.getElement().getOuterHTML().contains("Edge Routers"));
        assertEquals(0, find(Notification.class).all().size(), "no error toasts");
    }

    @Test
    void everyPortedPageRendersWithoutErrorToasts() {
        navigate(DashboardView.class);
        for (Class<? extends com.vaadin.flow.component.Component> page : java.util.List.of(IdentitiesView.class,
                ServicesView.class, RoutersView.class, PoliciesView.class, PostureChecksView.class, SettingsView.class,
                AuthenticationView.class, AttributesView.class, SessionsView.class, ConfigBuilderView.class,
                NetworkMapView.class, AccessCanvasView.class)) {
            navigate(page);
            assertEquals(0, find(Notification.class).all().size(), page.getSimpleName() + " raised a toast");
        }
    }

    @Test
    void configBuilder_previewsAndOpensRouterFiles() {
        navigate(DashboardView.class);
        ConfigBuilderView view = navigate(ConfigBuilderView.class);
        assertTrue(view.yaml().contains("listener: tls:0.0.0.0:6262"), view.yaml());
        assertTrue(view.issues().stream().noneMatch(com.example.configbuilder.ValidationIssue::isError));
        view.openFile("router.yml", com.example.configbuilder.ConfigBuilderRoundTripTest.EDGE_ROUTER);
        assertTrue(view.yaml().contains("# OpenZiti router configuration"));
        assertTrue(view.yaml().contains("plugins:\n  - name: example"), "unmanaged keys survive");
        assertTrue(view.getElement().getOuterHTML().contains("passing through untouched: plugins"));
    }

    @Test
    void networkMap_drawsDemoFabricAndSavesLocations() {
        navigate(DashboardView.class);
        NetworkMapView view = navigate(NetworkMapView.class);
        assertEquals(0, find(Notification.class).all().size(), "no error toasts");
        assertTrue(view.nodes().values().stream().anyMatch(n -> !n.kind().equals("identity") && n.point() != null),
                "demo routers are placed");
        assertTrue(!view.circuits().isEmpty(), "demo circuits are live");
        assertTrue(view.circuitsCsv().startsWith("Status,Service,Client,Host"), view.circuitsCsv());

        var unplaced = view.nodes().values().stream()
                .filter(n -> n.kind().equals("identity") && (n.point() == null || n.approxVia() != null)).findFirst()
                .orElseThrow();
        view.placeNodes(java.util.List.of(unplaced.id()), new com.example.netmap.NetworkMapLogic.Point(48.8566, 2.3522));
        assertEquals(1, view.pending().size());
        view.saveLocations();
        assertTrue(view.pending().isEmpty());
        var saved = ziti.getObject().list("identities").stream()
                .filter(i -> unplaced.id().equals(com.example.ziti.Json.str(i, "id"))).findFirst().orElseThrow();
        assertEquals("48.85660,2.35220", com.example.ziti.Json.str(saved, "tags.geolocation"));
        assertEquals("48.85660,2.35220",
                com.example.netmap.NetworkMapLogic.formatGeolocation(view.nodes().get(unplaced.id()).point()));
    }

    @Test
    void wizardPlan_appliesEndToEndInDemo() {
        navigate(DashboardView.class);
        ZitiService z = ziti.getObject();
        var model = z.loadCanvasModel();
        var w = com.example.canvas.WizardLogic.blank("ssh", "wiztest");
        w.newUserName = "wiztest-laptop";
        assertTrue(com.example.canvas.WizardLogic.validate(model, w).isEmpty(),
                () -> com.example.canvas.WizardLogic.validate(model, w).toString());
        int[] n = { 0 };
        var plan = com.example.canvas.WizardLogic.plan(model, w, () -> "new-t" + ++n[0]);
        z.applyCanvasOps(plan.ops(), new java.util.HashMap<>());
        var after = z.loadCanvasModel();
        assertTrue(after.services.stream().anyMatch(s -> s.name.equals("wiztest-ssh")));
        assertTrue(after.servicePolicies.stream().anyMatch(p -> p.name.equals("wiztest-ssh-dial")));
        assertTrue(after.identities.stream().anyMatch(i -> i.name.equals("wiztest-laptop")));
        // A second run with the same names is flagged as a conflict.
        assertTrue(!com.example.canvas.WizardLogic.detectConflicts(after, w).isEmpty());
    }
}
