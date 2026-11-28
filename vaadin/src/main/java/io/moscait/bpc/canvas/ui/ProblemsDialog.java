package io.moscait.bpc.canvas.ui;

import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

import io.moscait.bpc.canvas.Problems.ProblemRow;
import io.moscait.bpc.ui.Ui;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.grid.GridVariant;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.data.value.ValueChangeMode;

/** Audit of everything that keeps connections from completing, with Locate / Open actions. */
public class ProblemsDialog extends Dialog {

    private static final List<String> KINDS = List.of("all", "identity", "service", "router", "policy");

    private final List<ProblemRow> rows;
    private final Grid<ProblemRow> grid = new Grid<>();
    private String q = "";
    private String kind = "all";

    public ProblemsDialog(List<ProblemRow> rows, int total, boolean problemsOnly, Consumer<ProblemRow> onLocate,
            Consumer<ProblemRow> onOpen, Runnable onToggleProblemsOnly) {
        this.rows = rows;
        setHeaderTitle(total == 1 ? "1 item needs attention" : total + " items need attention");
        setWidth("min(68rem, 96vw)");

        TextField filter = new TextField();
        filter.setPlaceholder("Filter by name or problem…");
        filter.setAriaLabel("Filter problems");
        filter.setPrefixComponent(VaadinIcon.SEARCH.create());
        filter.setClearButtonVisible(true);
        filter.setValueChangeMode(ValueChangeMode.LAZY);
        filter.setWidth("18rem");
        filter.addValueChangeListener(e -> {
            q = e.getValue();
            refresh();
        });
        Tabs kinds = new Tabs();
        for (String k : KINDS) {
            long cnt = k.equals("all") ? rows.size() : rows.stream().filter(r -> r.kind().equals(k)).count();
            if (!k.equals("all") && cnt == 0) {
                continue;
            }
            Tab t = new Tab(k + " (" + cnt + ")");
            t.setId("kind-" + k);
            kinds.add(t);
        }
        kinds.addSelectedChangeListener(e -> {
            kind = e.getSelectedTab().getId().orElse("kind-all").substring(5);
            refresh();
        });
        Div bar = new Div(filter, kinds);
        bar.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("align-items", "center").set("gap", "12px");

        grid.addColumn(ProblemRow::typeLabel).setHeader("Type").setSortable(true).setAutoWidth(true).setFlexGrow(0);
        grid.addColumn(ProblemRow::name).setHeader("Name").setSortable(true).setAutoWidth(true);
        grid.addComponentColumn(r -> {
            Div d = new Div(Ui.strong(r.problem()));
            if (r.detail() != null && !r.detail().isEmpty()) {
                Div det = new Div(r.detail());
                det.addClassNames("bp-xs", "bp-muted");
                d.add(det);
            }
            return d;
        }).setHeader("Problem").setComparator(ProblemRow::problem).setSortable(true).setFlexGrow(2);
        grid.addComponentColumn(r -> {
            Span s = new Span(r.hint());
            s.addClassName("bp-xs");
            return s;
        }).setHeader("What to do").setFlexGrow(3);
        grid.addComponentColumn(r -> {
            Button locate = Ui.small("Locate", VaadinIcon.CROSSHAIRS, () -> {
                close();
                onLocate.accept(r);
            });
            Button open = Ui.small("Open", VaadinIcon.EXTERNAL_LINK, () -> {
                close();
                onOpen.accept(r);
            });
            Div d = new Div(locate, open);
            d.getStyle().set("display", "flex").set("gap", "4px");
            return d;
        }).setHeader("Actions").setAutoWidth(true).setFlexGrow(0);
        grid.addThemeVariants(GridVariant.WRAP_CELL_CONTENT, GridVariant.ROW_STRIPES);
        grid.setHeight("min(60vh, 560px)");
        grid.setAriaLabel("Problems");
        grid.setEmptyStateText("No problems match.");
        refresh();

        Div content = new Div(bar, grid);
        content.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "10px");
        add(content);
        Button toggle = new Button(problemsOnly ? "Show everything on canvas" : "Show only these on canvas",
                VaadinIcon.FILTER.create(), e -> {
                    close();
                    onToggleProblemsOnly.run();
                });
        getFooter().add(toggle, new Button("Close", e -> close()));
    }

    private void refresh() {
        String needle = q.trim().toLowerCase(Locale.ROOT);
        grid.setItems(rows.stream().filter(r -> kind.equals("all") || r.kind().equals(kind))
                .filter(r -> needle.isEmpty()
                        || (r.name() + " " + r.problem() + " " + r.detail()).toLowerCase(Locale.ROOT).contains(needle))
                .toList());
    }
}
