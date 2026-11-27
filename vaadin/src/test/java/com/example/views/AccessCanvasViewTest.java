package com.example.views;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.example.canvas.AccessLogic;
import com.example.canvas.AccessLogic.AcEndpoint;
import com.example.canvas.AcModel.AcIdentity;
import com.example.canvas.AcModel.AcKind;
import com.example.canvas.AcModel.AcService;
import com.example.canvas.ui.GrantAccessDialog;
import com.example.ziti.Json;
import com.example.ziti.ZitiService;
import com.vaadin.browserless.SpringBrowserlessTest;
import com.vaadin.flow.component.notification.Notification;

/** Access Canvas against the Demo Sandbox: board, grants, change sets, apply/undo, layout. */
@SpringBootTest(properties = "ziti.controller-url=https://127.0.0.1:9")
class AccessCanvasViewTest extends SpringBrowserlessTest {

    @Autowired
    ObjectProvider<ZitiService> ziti;

    private AccessCanvasView open() {
        navigate(DashboardView.class);
        AccessCanvasView view = navigate(AccessCanvasView.class);
        assertEquals(0, find(Notification.class).all().size(), "no error toasts");
        return view;
    }

    @Test
    void rendersTheDemoNetworkAsABoard() {
        AccessCanvasView view = open();
        assertFalse(view.currentBoard().nodes().isEmpty());
        Map<String, Object> json = Json.parseObject(view.board().boardJson());
        assertFalse(Json.objects(json, "nodes").isEmpty());
        assertFalse(Json.objects(json, "edges").isEmpty(), "policies draw lines");
        assertTrue(view.board().boardJson().contains("\"type\":\"hub\""));
    }

    @Test
    void grantQueuesThenAppliesAndUndoes() {
        AccessCanvasView view = open();
        // An identity/service pair that cannot connect yet.
        AcIdentity who = null;
        AcService what = null;
        outer: for (AcIdentity i : AccessLogic.clients(view.draft())) {
            for (AcService s : view.draft().services) {
                if (AccessLogic.dialFor(view.draft(), i, s).isEmpty()) {
                    who = i;
                    what = s;
                    break outer;
                }
            }
        }
        assertNotNull(who, "the demo has a pair without access");
        view.openGrant(AcEndpoint.identity(who.id), AcEndpoint.service(what.id));
        GrantAccessDialog dialog = find(GrantAccessDialog.class).single();
        assertFalse(dialog.result().already());
        assertFalse(dialog.result().opts().isEmpty());
        dialog.choose(0);
        assertEquals(1, view.pendingSets().size());
        String sid = what.id;
        String iid = who.id;
        assertTrue(!AccessLogic.dialFor(view.draft(), find(view, iid), view.draft().services.stream()
                .filter(s -> s.id.equals(sid)).findFirst().orElseThrow()).isEmpty(), "the draft shows the new access");

        view.applyAll();
        assertTrue(view.pendingSets().isEmpty());
        var committed = ziti.getObject().loadCanvasModel();
        AcIdentity ci = committed.identities.stream().filter(i -> i.id.equals(iid)).findFirst().orElseThrow();
        AcService cs = committed.services.stream().filter(s -> s.id.equals(sid)).findFirst().orElseThrow();
        assertFalse(AccessLogic.dialFor(committed, ci, cs).isEmpty(), "applied to the controller");

        view.undoLast();
        var after = ziti.getObject().loadCanvasModel();
        AcIdentity ai = after.identities.stream().filter(i -> i.id.equals(iid)).findFirst().orElseThrow();
        AcService as = after.services.stream().filter(s -> s.id.equals(sid)).findFirst().orElseThrow();
        assertTrue(AccessLogic.dialFor(after, ai, as).isEmpty(), "undo reverted it");
    }

    private static AcIdentity find(AccessCanvasView v, String id) {
        return v.draft().identities.stream().filter(i -> i.id.equals(id)).findFirst().orElseThrow();
    }

    @Test
    void newGroupsLayoutAndClipboard() {
        AccessCanvasView view = open();
        assertTrue(view.addGroup(AcKind.IDENTITY, "#qa-team", 900, 900));
        assertTrue(view.layoutKeys().stream().anyMatch(k -> k.contains("qa-team")));
        assertTrue(view.currentBoard().nodes().stream().anyMatch(n -> "qa-team".equals(n.attr)));

        String exported = view.exportLayout();
        assertTrue(exported.contains("ziti-access-canvas-layout"));
        var parsed = AccessCanvasView.parseLayout(exported);
        assertNotNull(parsed);
        assertTrue(parsed.groups.contains("identity:qa-team"));
        assertEquals(null, AccessCanvasView.parseLayout("{\"kind\":\"something-else\",\"nodes\":{}}"));
        assertEquals(null, AccessCanvasView.parseLayout("not json"));

        // Copy a group member, then paste into the new group: queues an attribute change.
        var group = view.currentBoard().nodes().stream()
                .filter(n -> n.type.equals("group") && n.kind == AcKind.IDENTITY && !n.shown.isEmpty()).findFirst()
                .orElseThrow();
        var m = group.shown.getFirst();
        Map<String, Object> item = Json.map("type", "member", "node", group.key, "kind", "identity", "id", m.id, "name",
                m.name, "attr", group.attr);
        view.onCommand(Json.map("cmd", "copy", "items", List.of(item)));
        assertNotNull(view.clip());
        var target = view.currentBoard().nodes().stream().filter(n -> "qa-team".equals(n.attr)).findFirst().orElseThrow();
        view.onCommand(Json.map("cmd", "paste", "items",
                List.of(Json.map("type", "group", "node", target.key, "kind", "identity", "attr", "qa-team")), "at",
                Json.map("x", 0, "y", 0)));
        assertEquals(1, view.pendingSets().size(), "paste into group is staged");
        assertTrue(view.draft().identities.stream().anyMatch(i -> i.id.equals(m.id) && i.attrs.contains("qa-team")));

        // Ctrl+Z on the board drops the staged change.
        view.onCommand(Json.map("cmd", "undo"));
        assertTrue(view.pendingSets().isEmpty());
    }
}
