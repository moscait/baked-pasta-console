package io.moscait.bpc.canvas.ui;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.canvas.BoardLogic.Anchor;
import io.moscait.bpc.canvas.BoardLogic.Board;
import io.moscait.bpc.canvas.BoardLogic.BoardEdge;
import io.moscait.bpc.canvas.BoardLogic.BoardMember;
import io.moscait.bpc.canvas.BoardLogic.BoardNode;
import io.moscait.bpc.ziti.Json;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.ComponentEvent;
import com.vaadin.flow.component.ComponentEventListener;
import com.vaadin.flow.component.DomEvent;
import com.vaadin.flow.component.EventData;
import com.vaadin.flow.component.HasSize;
import com.vaadin.flow.component.Tag;
import com.vaadin.flow.component.dependency.JsModule;
import com.vaadin.flow.shared.Registration;

/**
 * Server side of {@code <ac-board>} (frontend/ac-board.ts): the board is computed here by
 * BoardLogic and sent as JSON; gestures come back as typed events whose payload is JSON.
 */
@Tag("ac-board")
@JsModule("./ac-board.ts")
public class AcBoard extends Component implements HasSize {

    /** Base for board events: {@link #payload()} is the gesture's JSON, parsed. */
    public abstract static class BoardEvent extends ComponentEvent<AcBoard> {
        private final String json;

        protected BoardEvent(AcBoard source, boolean fromClient, String json) {
            super(source, fromClient);
            this.json = json;
        }

        public Map<String, Object> payload() {
            return Json.parseObject(json == null || json.isEmpty() ? "{}" : json);
        }
    }

    @DomEvent("ac-moved")
    public static class MovedEvent extends BoardEvent {
        public MovedEvent(AcBoard source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }
    }

    @DomEvent("ac-member-drop")
    public static class MemberDropEvent extends BoardEvent {
        public MemberDropEvent(AcBoard source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }
    }

    @DomEvent("ac-node-drop")
    public static class NodeDropEvent extends BoardEvent {
        public NodeDropEvent(AcBoard source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }
    }

    @DomEvent("ac-command")
    public static class CommandEvent extends BoardEvent {
        public CommandEvent(AcBoard source, boolean fromClient, @EventData("event.detail.json") String json) {
            super(source, fromClient, json);
        }
    }

    private String lastJson = "";

    public AcBoard() {
        setSizeFull();
    }

    public void setBoard(Board board) {
        String json = Json.write(toJson(board));
        if (!json.equals(lastJson)) {
            lastJson = json;
            getElement().setProperty("boardJson", json);
        }
    }

    public void setHasClip(boolean hasClip) {
        getElement().setProperty("hasClip", hasClip);
    }

    public void setReadOnly(boolean readOnly) {
        getElement().setProperty("readOnly", readOnly);
    }

    /** "board" (free-form) or "graph" (connector handles and a minimap). */
    public void setMode(String mode) {
        getElement().setProperty("mode", mode);
    }

    public void fit() {
        getElement().callJsFunction("refit");
    }

    public void reveal(String nodeKey, String memberKey) {
        getElement().callJsFunction("reveal", nodeKey, memberKey);
    }

    public Registration addMovedListener(ComponentEventListener<MovedEvent> l) {
        return addListener(MovedEvent.class, l);
    }

    public Registration addMemberDropListener(ComponentEventListener<MemberDropEvent> l) {
        return addListener(MemberDropEvent.class, l);
    }

    public Registration addNodeDropListener(ComponentEventListener<NodeDropEvent> l) {
        return addListener(NodeDropEvent.class, l);
    }

    public Registration addCommandListener(ComponentEventListener<CommandEvent> l) {
        return addListener(CommandEvent.class, l);
    }

    /** What was last sent to the client (tests). */
    public String boardJson() {
        return lastJson;
    }

    // ------------------------------------------------------------------ serialization

    static Map<String, Object> toJson(Board b) {
        List<Object> nodes = new ArrayList<>();
        for (BoardNode n : b.nodes()) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("key", n.key);
            o.put("type", n.type);
            o.put("kind", n.kind == null ? null : n.kind.one);
            o.put("attr", n.attr);
            if (n.entity != null) {
                o.put("entity", member(n.entity));
            }
            if (n.policy != null) {
                o.put("policy", Json.map("id", n.policy.id(), "name", n.policy.name(), "family", n.policy.family(),
                        "semantic", n.policy.semantic(), "posture", n.policy.posture(), "all", n.policy.all()));
            }
            o.put("memberCount", n.members.size());
            o.put("members", n.members.stream().map(m -> (Object) Json.map("id", m.id, "name", m.name)).toList());
            o.put("shown", n.shown.stream().map(m -> (Object) member(m)).toList());
            o.put("more", n.more);
            o.put("x", n.x);
            o.put("y", n.y);
            o.put("w", n.w);
            o.put("h", n.h);
            o.put("problems", n.problems);
            o.put("problemCount", n.problemCount);
            o.put("pending", n.pending);
            o.put("hit", n.hit);
            o.put("dim", n.dim);
            nodes.add(o);
        }
        List<Object> edges = new ArrayList<>();
        for (BoardEdge e : b.edges()) {
            edges.add(Json.map("id", e.id(), "family", e.family(), "from", anchor(e.from()), "to", anchor(e.to()),
                    "pending", e.pending(), "byName", e.byName()));
        }
        return Json.map("nodes", nodes, "edges", edges);
    }

    private static Map<String, Object> anchor(Anchor a) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("node", a.node());
        o.put("member", a.member());
        return o;
    }

    private static Map<String, Object> member(BoardMember m) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("id", m.id);
        o.put("name", m.name);
        o.put("problems", m.problems == null ? List.of() : m.problems);
        o.put("pending", m.pending);
        o.put("hit", m.hit);
        o.put("ips", m.ips);
        o.put("liveSessions", m.liveSessions);
        o.put("concurrentSeverity", m.concurrentSeverity);
        return o;
    }
}
