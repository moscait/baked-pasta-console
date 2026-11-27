package com.example.views;

import java.util.List;
import java.util.Map;

import com.example.ui.EntityGrid;
import com.example.ui.MainLayout;
import com.example.ui.Ui;
import com.example.ui.ZitiView;
import com.example.ziti.AttributeIndex;
import com.example.ziti.Json;
import com.example.ziti.ZitiService;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.html.Code;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.ListItem;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.html.UnorderedList;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.router.PageTitle;
import com.vaadin.flow.router.Route;

/** Every {@code #attribute} on the network, who carries it, which policies select it, and mismatches. */
@Route(value = "attributes", layout = MainLayout.class)
@PageTitle("Attributes")
public class AttributesView extends ZitiView {

    private final EntityGrid grid = new EntityGrid("Attributes");
    private final Button issuesButton = new Button();
    private List<Map<String, Object>> rows = List.of();
    private boolean issuesOnly;

    public AttributesView(ZitiService ziti) {
        super(ziti);
        grid.searchPlaceholder("Search attribute, member, or policy…");
        grid.component("Attribute", r -> Json.str(r, "name"), r -> {
            Button b = new Button("#" + Json.str(r, "name"), e -> openDetail(r));
            b.addThemeVariants(ButtonVariant.TERTIARY);
            b.addClassNames("bp-mono", "bp-strong");
            return b;
        });
        count("identity", "Identities");
        count("service", "Services");
        count("router", "Edge Routers");
        count("posture", "Posture Checks");
        grid.number("Used by Policies", r -> AttributeIndex.refs(r).size());
        grid.component("Status", AttributeIndex::status, r -> {
            String s = AttributeIndex.status(r);
            Span chip = Ui.chip(s.equals("Selects nothing") ? "Policy selects nothing" : s,
                    s.equals("OK") ? "ok" : s.equals("Selects nothing") ? "bad" : "warn");
            if (s.equals("Selects nothing")) {
                chip.getElement().setAttribute("title", String.join("\n", AttributeIndex.dangling(r).stream()
                        .map(d -> d.get("policyName") + " selects #" + r.get("name") + " on "
                                + AttributeIndex.KIND_LABEL.get(d.get("selects")))
                        .toList()));
            }
            return chip;
        });
        issuesButton.setIcon(VaadinIcon.WARNING.create());
        issuesButton.addClickListener(e -> {
            issuesOnly = !issuesOnly;
            show();
        });
        grid.headerRight(issuesButton);

        add(Ui.page(Ui.pageHeader("Attributes", "Every #attribute on the network: which identities, services, routers "
                + "and posture checks carry it, and which policies select it."), grid));
    }

    private void count(String kind, String header) {
        grid.number(header, r -> AttributeIndex.members(r, kind).size());
    }

    @Override
    protected void reload() {
        rows = AttributeIndex.build(new AttributeIndex.Input(ziti.list("identities"), ziti.list("services"),
                ziti.list("edge-routers"), ziti.list("posture-checks"), ziti.list("service-policies"),
                ziti.list("edge-router-policies"), ziti.list("service-edge-router-policies")));
        show();
    }

    private void show() {
        long dangling = rows.stream().filter(r -> !AttributeIndex.dangling(r).isEmpty()).count();
        if (dangling == 0) {
            issuesOnly = false;
        }
        issuesButton.setVisible(dangling > 0);
        issuesButton.setText(issuesOnly ? "Show all attributes"
                : dangling + " attribute" + (dangling == 1 ? "" : "s") + " selected by a policy but carried by nothing");
        issuesButton.removeThemeVariants(ButtonVariant.PRIMARY);
        issuesButton.addThemeVariants(ButtonVariant.ERROR);
        if (issuesOnly) {
            issuesButton.addThemeVariants(ButtonVariant.PRIMARY);
        }
        grid.setRows(issuesOnly ? rows.stream().filter(r -> !AttributeIndex.dangling(r).isEmpty()).toList() : rows);
    }

    private void openDetail(Map<String, Object> r) {
        String name = Json.str(r, "name");
        Dialog d = new Dialog();
        d.setHeaderTitle("#" + name);
        d.setWidth("min(760px, 96vw)");
        d.getHeader().add(Ui.iconButton(VaadinIcon.CLOSE, "Close", d::close));
        Div body = new Div();
        body.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "14px");
        List<Map<String, Object>> dangling = AttributeIndex.dangling(r);
        if (!dangling.isEmpty()) {
            Div box = Ui.callout("error");
            for (Map<String, Object> x : dangling) {
                box.add(new Div(Ui.strong(String.valueOf(x.get("policyName"))), new Span(" selects "), new Code("#" + name),
                        new Span(" on " + AttributeIndex.KIND_LABEL.get(x.get("selects"))
                                + ", but none carry it, so that part of the policy matches nothing.")));
            }
            body.add(box);
        }
        Div kinds = new Div();
        kinds.getStyle().set("display", "grid").set("grid-template-columns", "repeat(auto-fit, minmax(160px, 1fr))")
                .set("gap", "12px");
        for (String k : AttributeIndex.KINDS) {
            List<Map<String, Object>> m = AttributeIndex.members(r, k);
            kinds.add(section(capitalize(AttributeIndex.KIND_LABEL.get(k)) + " (" + m.size() + ")",
                    m.isEmpty() ? Ui.muted("None") : list(m.stream().map(x -> (Component) new Span(String.valueOf(x.get("name")))).toList())));
        }
        body.add(kinds);
        List<Map<String, Object>> refs = AttributeIndex.refs(r);
        body.add(section("Policies selecting #" + name + " (" + refs.size() + ")",
                refs.isEmpty() ? Ui.muted("No policy selects this attribute yet.")
                        : list(refs.stream().map(x -> (Component) new Span(Ui.strong(String.valueOf(x.get("policyName"))),
                                Ui.muted("  " + x.get("policyType") + ", selecting "
                                        + AttributeIndex.KIND_LABEL.get(x.get("selects")))))
                                .toList())));
        d.add(body);
        d.open();
    }

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private static Div section(String title, Component content) {
        Div h = new Div(title);
        h.addClassNames("bp-xs", "bp-muted", "bp-strong");
        h.getStyle().set("text-transform", "uppercase").set("letter-spacing", "0.05em").set("margin-bottom", "4px");
        Div d = new Div(h, content);
        d.addClassName("bp-card");
        d.getStyle().set("padding", "10px 12px");
        return d;
    }

    private static UnorderedList list(List<Component> items) {
        UnorderedList ul = new UnorderedList();
        ul.getStyle().set("margin", "0").set("padding-left", "18px");
        ul.addClassName("bp-small");
        items.forEach(i -> ul.add(new ListItem(i)));
        return ul;
    }
}
