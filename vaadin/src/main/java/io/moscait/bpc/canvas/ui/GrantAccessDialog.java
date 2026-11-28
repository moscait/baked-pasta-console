package io.moscait.bpc.canvas.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import io.moscait.bpc.canvas.AccessLogic;
import io.moscait.bpc.canvas.AccessLogic.AcEndpoint;
import io.moscait.bpc.canvas.AccessLogic.AcGrantResult;
import io.moscait.bpc.canvas.AccessLogic.AcImpact;
import io.moscait.bpc.canvas.AccessLogic.AcOption;
import io.moscait.bpc.canvas.AcModel;
import io.moscait.bpc.canvas.AcModel.AcOp;
import io.moscait.bpc.canvas.AcModel.AcService;
import io.moscait.bpc.ui.Ui;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.details.Details;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Pre;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.select.Select;

/** Ranked ways to give an identity (or group) access to a service (or group), with their impact. */
public class GrantAccessDialog extends Dialog {

    /** Receives the chosen option as a change set. */
    public interface Queue {
        void queue(String title, String summary, List<AcOp> ops);
    }

    private record Choice(String label, String group, AcEndpoint endpoint) {
    }

    private final AcModel draft;
    private final AcEndpoint src;
    private final Supplier<String> newId;
    private final Queue onQueue;
    private AcGrantResult result;
    private int selected;
    private final Div body = new Div();
    private final Button add = Ui.primary("Add to pending changes", VaadinIcon.PLUS, this::queueSelected);

    public GrantAccessDialog(AcModel draft, AcEndpoint src, AcEndpoint tgt, Supplier<String> newId, Queue onQueue) {
        this.draft = draft;
        this.src = src;
        this.newId = newId;
        this.onQueue = onQueue;
        setWidth("min(44rem, 94vw)");
        body.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "10px");
        add(body);
        getFooter().add(new Button("Cancel", e -> close()), add);

        List<Choice> choices = new ArrayList<>();
        for (Map.Entry<String, List<AcService>> g : AccessLogic.groups(draft.services)) {
            if (!g.getKey().isEmpty()) {
                choices.add(new Choice("#" + g.getKey(), "Service groups", AcEndpoint.group(g.getKey())));
            }
        }
        for (AcService s : draft.services) {
            choices.add(new Choice(s.name, "Services", AcEndpoint.service(s.id)));
        }
        Select<Choice> target = new Select<>();
        target.setLabel("To");
        target.setPlaceholder("Choose…");
        target.setItems(choices);
        target.setItemLabelGenerator(c -> c.label() + (c.group().equals("Service groups") ? "  (group)" : ""));
        target.setWidthFull();
        if (tgt != null) {
            choices.stream().filter(c -> c.endpoint().equals(tgt)).findFirst().ifPresent(target::setValue);
        }
        target.addValueChangeListener(e -> {
            if (e.getValue() != null) {
                build(e.getValue().endpoint());
            }
        });
        this.targetSelect = target;
        if (tgt != null) {
            build(tgt);
        } else {
            render();
        }
    }

    private final Select<Choice> targetSelect;

    private void build(AcEndpoint tgt) {
        result = AccessLogic.buildOptions(draft, src, tgt, newId);
        selected = 0;
        for (int i = 0; i < result.opts().size(); i++) {
            if (result.opts().get(i).recommended) {
                selected = i;
                break;
            }
        }
        render();
    }

    private String srcName() {
        if (src.kind().equals("group")) {
            return "#" + src.attr();
        }
        return draft.identities.stream().filter(i -> i.id.equals(src.id())).map(i -> i.name).findFirst().orElse("");
    }

    private static String plural(int n, String one, String many) {
        return n + " " + (n == 1 ? one : many);
    }

    private void render() {
        body.removeAll();
        setHeaderTitle(result != null ? "How should " + result.srcLabel() + " get " + result.tgtLabel() + "?"
                : "Give " + srcName() + " access");
        if (result != null) {
            Span a = Ui.chip(result.srcLabel(), null);
            Span b = Ui.chip(result.tgtLabel(), null);
            Div path = new Div(a, Ui.icon(VaadinIcon.ARROW_RIGHT, null), b);
            path.addClassName("ac-grant-path");
            body.add(path);
        }
        body.add(targetSelect);
        add.setVisible(result != null && !result.already());
        if (result == null) {
            return;
        }
        Paragraph lead = new Paragraph("OpenZiti grants access through attribute-based policies. Pick the option that "
                + "matches your intent.");
        lead.addClassNames("bp-xs", "bp-muted");
        lead.getStyle().set("margin", "0");
        body.add(lead);
        if (!result.unhosted().isEmpty()) {
            body.add(Ui.callout("warn", String.join(", ", result.unhosted())
                    + (result.unhosted().size() == 1 ? " has" : " have") + " no hosting identity yet. Access will be "
                    + "granted, but connections won't complete until a Bind policy exists."));
        }
        if (result.already()) {
            body.add(Ui.callout("ok", "✓ Already allowed by " + String.join(", ", result.allowedBy()) + ". Nothing to change."));
            return;
        }
        Div opts = new Div();
        opts.getElement().setAttribute("role", "radiogroup");
        opts.getElement().setAttribute("aria-label", "Ways to grant access");
        opts.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "8px");
        for (int idx = 0; idx < result.opts().size(); idx++) {
            AcOption o = result.opts().get(idx);
            int i = idx;
            Div title = new Div(new Span(o.title));
            title.addClassName("title");
            if (o.recommended) {
                title.add(Ui.chip("Recommended", "ok"));
            }
            if (o.exception) {
                title.add(Ui.chip("Exception", "warn"));
            }
            Div card = new Div(title);
            card.addClassName("ac-option");
            card.getElement().setAttribute("role", "radio");
            card.getElement().setAttribute("tabindex", "0");
            card.getElement().setAttribute("aria-checked", String.valueOf(selected == idx));
            if (o.why != null && !o.why.isEmpty()) {
                Div why = new Div(o.why);
                why.addClassName("bp-muted");
                card.add(why);
            }
            AcImpact im = o.impact;
            card.add(new Div(im.pairs() > 0 ? "Grants " + plural(im.identities(), "identity", "identities") + " access to "
                    + plural(im.services(), "service", "services") + " (" + plural(im.pairs(), "new pair", "new pairs") + ")."
                    : "No new access."));
            if (!im.outside().isEmpty()) {
                Div out = new Div("Also affects: " + String.join(", ", im.outside()));
                out.getStyle().set("color", "var(--ac-pending)");
                card.add(out);
            }
            if (im.noRoute() > 0) {
                Div nr = new Div(plural(im.noRoute(), "pair has", "pairs have") + " no shared edge router yet.");
                nr.getStyle().set("color", "var(--ac-pending)");
                card.add(nr);
            }
            Details calls = new Details(plural(o.calls.size(), "API call", "API calls"), new Pre(String.join("\n\n", o.calls)));
            calls.addClassName("bp-xs");
            card.add(calls);
            card.addClickListener(e -> {
                selected = i;
                render();
            });
            card.getElement().addEventListener("keydown", e -> {
                selected = i;
                render();
            }).setFilter("event.key === ' ' || event.key === 'Enter'");
            opts.add(card);
        }
        body.add(opts);
    }

    private void queueSelected() {
        if (result == null || selected >= result.opts().size()) {
            return;
        }
        AcOption o = result.opts().get(selected);
        AcImpact i = o.impact;
        onQueue.queue(o.title, result.srcLabel() + " → " + result.tgtLabel() + ". "
                + (i.pairs() > 0 ? plural(i.identities(), "identity", "identities") + ", "
                        + plural(i.services(), "service", "services") : "no new access")
                + ".", o.ops);
        close();
    }

    /** Test hook. */
    public AcGrantResult result() {
        return result;
    }

    /** Test hook: queue the option at this index. */
    public void choose(int index) {
        selected = index;
        queueSelected();
    }
}
