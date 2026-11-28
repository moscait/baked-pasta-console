package io.moscait.bpc.ui;

import java.nio.charset.StandardCharsets;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Function;

import io.moscait.bpc.ziti.FormValues;
import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiException;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.Composite;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.grid.Grid;
import com.vaadin.flow.component.grid.GridVariant;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.ListItem;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.html.UnorderedList;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.data.provider.ListDataProvider;
import com.vaadin.flow.data.value.ValueChangeMode;
import com.vaadin.flow.server.streams.DownloadHandler;

/**
 * The list table every entity page uses: search, sortable columns, CSV export of the shown rows,
 * create, edit/delete actions with a confirm, and bulk delete of the selected rows.
 */
public class EntityGrid extends Composite<Div> {

    public interface Deleter {
        void delete(Map<String, Object> row);
    }

    private static final Collator COLLATOR = Collator.getInstance();

    static {
        COLLATOR.setStrength(Collator.PRIMARY);
    }

    private record Col(String header, Function<Map<String, Object>, Object> value, boolean numeric) {
    }

    private final String caption;
    private final Grid<Map<String, Object>> grid = new Grid<>();
    private final List<Col> cols = new ArrayList<>();
    private final TextField search = new TextField();
    private final Div tools = new Div();
    private final Div left = new Div();
    private final Div right = new Div();
    private final Button bulkButton = new Button();
    private List<Map<String, Object>> rows = List.of();
    private ListDataProvider<Map<String, Object>> provider;
    private Deleter deleter;
    private Function<Map<String, Object>, List<Component>> extraActions;
    private Consumer<Map<String, Object>> editor;
    private boolean actionsAdded;
    private Function<Map<String, Object>, String> searchText = Json::write;

    public EntityGrid(String caption) {
        this.caption = caption;
        Div root = getContent();
        root.getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "var(--vaadin-gap-m)");

        search.setPlaceholder("Search by name or attribute…");
        search.setPrefixComponent(VaadinIcon.SEARCH.create());
        search.setClearButtonVisible(true);
        search.setValueChangeMode(ValueChangeMode.LAZY);
        search.addClassName("search");
        search.setAriaLabel("Search " + caption);
        search.addValueChangeListener(e -> applyFilter());

        left.addClassName("bp-table-tools");
        right.addClassName("bp-table-tools");
        left.add(search);
        tools.getStyle().set("display", "flex").set("flex-wrap", "wrap").set("justify-content", "space-between")
                .set("gap", "var(--vaadin-gap-s)");
        tools.add(left, right);

        bulkButton.setIcon(VaadinIcon.TRASH.create());
        bulkButton.addThemeVariants(ButtonVariant.ERROR);
        bulkButton.setVisible(false);
        bulkButton.addClickListener(e -> openBulkDelete());

        Anchor export = new Anchor(DownloadHandler.fromInputStream(event -> {
            byte[] bytes = csv().getBytes(StandardCharsets.UTF_8);
            return new com.vaadin.flow.server.streams.DownloadResponse(new java.io.ByteArrayInputStream(bytes),
                    FormValues.csvFileName(caption), "text/csv", bytes.length);
        }), "");
        Button exportButton = new Button("Export CSV", VaadinIcon.DOWNLOAD_ALT.create());
        exportButton.setTooltipText("Download the shown rows as CSV");
        export.add(exportButton);
        right.add(bulkButton, export);

        grid.addClassName("bp-grid");
        grid.addThemeVariants(GridVariant.ROW_STRIPES, GridVariant.WRAP_CELL_CONTENT);
        grid.setAllRowsVisible(false);
        grid.setHeight("min(68vh, 760px)");
        grid.setEmptyStateText("No records match your filter.");
        grid.setAriaLabel(caption);
        root.add(tools, grid);
    }

    // ------------------------------------------------------------------ configuration

    /** Adds a text column that sorts and exports by {@code value}. */
    public Grid.Column<Map<String, Object>> text(String header, Function<Map<String, Object>, Object> value) {
        cols.add(new Col(header, value, false));
        Grid.Column<Map<String, Object>> c = grid.addColumn(r -> Objects.toString(value.apply(r), ""))
                .setHeader(header).setAutoWidth(true).setResizable(true)
                .setComparator(comparator(value, false));
        return c;
    }

    /** Adds the bold name column. */
    public Grid.Column<Map<String, Object>> name(String header) {
        Function<Map<String, Object>, Object> v = r -> Json.str(r, "name");
        cols.add(new Col(header, v, false));
        return grid.addComponentColumn(r -> {
            Span s = new Span(Objects.toString(v.apply(r), ""));
            s.addClassName("bp-cell-name");
            return s;
        }).setHeader(header).setAutoWidth(true).setResizable(true).setFlexGrow(1).setComparator(comparator(v, false));
    }

    public Grid.Column<Map<String, Object>> number(String header, Function<Map<String, Object>, Object> value) {
        cols.add(new Col(header, value, true));
        return grid.addColumn(r -> Objects.toString(value.apply(r), "")).setHeader(header).setAutoWidth(true)
                .setComparator(comparator(value, true));
    }

    /** Adds a column rendered by {@code render}; {@code value} drives sort and CSV. */
    public Grid.Column<Map<String, Object>> component(String header, Function<Map<String, Object>, Object> value,
            Function<Map<String, Object>, Component> render) {
        cols.add(new Col(header, value, false));
        Grid.Column<Map<String, Object>> c = grid.addComponentColumn(render::apply).setHeader(header).setAutoWidth(true)
                .setResizable(true);
        if (value != null) {
            c.setComparator(comparator(value, false));
        } else {
            c.setSortable(false);
        }
        return c;
    }

    public Grid.Column<Map<String, Object>> attributes(String header, String field) {
        return component(header, r -> Json.strings(r, field), r -> Ui.attrChips(Json.strings(r, field)));
    }

    private static Comparator<Map<String, Object>> comparator(Function<Map<String, Object>, Object> value,
            boolean numeric) {
        if (numeric) {
            return Comparator.comparingDouble(r -> {
                Object v = value.apply(r);
                if (v instanceof Number n) {
                    return n.doubleValue();
                }
                try {
                    return Double.parseDouble(String.valueOf(v));
                } catch (RuntimeException e) {
                    return 0;
                }
            });
        }
        return (a, b) -> COLLATOR.compare(Objects.toString(value.apply(a), ""), Objects.toString(value.apply(b), ""));
    }

    public EntityGrid onCreate(String label, Runnable create) {
        Button b = new Button(label, VaadinIcon.PLUS.create(), e -> create.run());
        b.addThemeVariants(ButtonVariant.PRIMARY);
        right.add(b);
        return this;
    }

    public EntityGrid onEdit(Consumer<Map<String, Object>> edit) {
        this.editor = edit;
        return this;
    }

    public EntityGrid onDelete(Deleter delete) {
        this.deleter = delete;
        grid.setSelectionMode(Grid.SelectionMode.MULTI);
        grid.asMultiSelect().addValueChangeListener(e -> updateBulk());
        return this;
    }

    public EntityGrid extraActions(Function<Map<String, Object>, List<Component>> actions) {
        this.extraActions = actions;
        return this;
    }

    public EntityGrid searchPlaceholder(String text) {
        search.setPlaceholder(text);
        return this;
    }

    public EntityGrid searchText(Function<Map<String, Object>, String> fn) {
        this.searchText = fn;
        return this;
    }

    /** Components shown left of the search field (tabs, filters). */
    public EntityGrid headerLeft(Component... c) {
        left.addComponentAsFirst(new Div(c));
        return this;
    }

    public EntityGrid headerRight(Component... c) {
        for (Component x : c) {
            right.addComponentAtIndex(Math.max(0, right.getComponentCount() - 1), x);
        }
        return this;
    }

    public EntityGrid noExport() {
        right.getChildren().filter(Anchor.class::isInstance).forEach(a -> a.setVisible(false));
        return this;
    }

    public void setSearch(String text) {
        search.setValue(text == null ? "" : text);
    }

    public Grid<Map<String, Object>> grid() {
        return grid;
    }

    /** Adds the actions column; called lazily on the first setRows so options set later still apply. */
    private void ensureActions() {
        if (actionsAdded || (editor == null && deleter == null && extraActions == null)) {
            return;
        }
        actionsAdded = true;
        grid.addComponentColumn(r -> {
            Div d = new Div();
            d.addClassName("bp-actions");
            if (extraActions != null) {
                extraActions.apply(r).forEach(d::add);
            }
            if (editor != null) {
                d.add(Ui.iconButton(VaadinIcon.EDIT, "Edit", () -> editor.accept(r)));
            }
            if (deleter != null) {
                Button del = Ui.iconButton(VaadinIcon.TRASH, "Delete " + label(r), () -> confirmDelete(r));
                del.addThemeVariants(ButtonVariant.ERROR);
                d.add(del);
            }
            return d;
        }).setHeader("Actions").setAutoWidth(true).setFlexGrow(0).setFrozenToEnd(true);
    }

    // ------------------------------------------------------------------ data

    public void setRows(List<Map<String, Object>> rows) {
        ensureActions();
        Set<Map<String, Object>> prevSel = deleter != null ? grid.asMultiSelect().getValue() : Set.of();
        Set<Object> prevIds = new java.util.HashSet<>();
        prevSel.forEach(r -> prevIds.add(r.get("id")));
        this.rows = rows;
        provider = new ListDataProvider<>(new ArrayList<>(rows));
        grid.setItems(provider);
        applyFilter();
        if (deleter != null && !prevIds.isEmpty()) {
            rows.stream().filter(r -> prevIds.contains(r.get("id"))).forEach(r -> grid.asMultiSelect().select(r));
        }
        updateBulk();
    }

    public List<Map<String, Object>> rows() {
        return rows;
    }

    private void applyFilter() {
        if (provider == null) {
            return;
        }
        String q = search.getValue().trim().toLowerCase();
        if (q.isEmpty()) {
            provider.clearFilters();
        } else {
            provider.setFilter(r -> searchText.apply(r).toLowerCase().contains(q));
        }
    }

    private List<Map<String, Object>> shown() {
        return grid.getGenericDataView().getItems().toList();
    }

    private String csv() {
        List<String> headers = cols.stream().map(Col::header).toList();
        List<List<Object>> out = new ArrayList<>();
        for (Map<String, Object> r : shown()) {
            List<Object> line = new ArrayList<>();
            for (Col c : cols) {
                line.add(c.value() == null ? "" : c.value().apply(r));
            }
            out.add(line);
        }
        return FormValues.toCsv(headers, out);
    }

    private static String label(Map<String, Object> r) {
        return Json.strOr(r, "name", Json.strOr(r, "id", "item"));
    }

    private List<Map<String, Object>> selectedShown() {
        if (deleter == null) {
            return List.of();
        }
        Set<Map<String, Object>> sel = grid.asMultiSelect().getValue();
        return shown().stream().filter(sel::contains).toList();
    }

    private void updateBulk() {
        int n = selectedShown().size();
        bulkButton.setVisible(n > 0);
        bulkButton.setText("Delete selected (" + n + ")");
    }

    // ------------------------------------------------------------------ delete dialogs

    private void confirmDelete(Map<String, Object> row) {
        Dialog d = new Dialog();
        d.setHeaderTitle("Delete this item?");
        Paragraph p = new Paragraph();
        p.add(new Span("Permanently delete "), Ui.strong(label(row)), new Span(" from " + caption.toLowerCase()
                + "? This takes effect on the controller immediately and cannot be undone."));
        Div err = Ui.callout("error", "");
        err.setVisible(false);
        d.add(new Div(p, err));
        Button cancel = new Button("Cancel", e -> d.close());
        Button del = new Button("Delete", VaadinIcon.TRASH.create());
        del.addThemeVariants(ButtonVariant.PRIMARY, ButtonVariant.ERROR);
        del.addClickListener(e -> {
            try {
                deleter.delete(row);
                d.close();
            } catch (RuntimeException ex) {
                err.removeAll();
                err.add(new Span(ZitiException.text(ex)));
                err.setVisible(true);
            }
        });
        d.getFooter().add(cancel, del);
        d.open();
        del.focus();
    }

    private void openBulkDelete() {
        List<Map<String, Object>> targets = selectedShown();
        if (targets.isEmpty()) {
            return;
        }
        Dialog d = new Dialog();
        d.setHeaderTitle("Delete " + targets.size() + " items?");
        UnorderedList ul = new UnorderedList();
        ul.addClassName("bp-callout");
        ul.getStyle().set("list-style", "none").set("max-height", "12rem").set("overflow", "auto")
                .set("font-family", "var(--ac-mono)");
        targets.forEach(t -> ul.add(new ListItem(label(t))));
        d.add(new Paragraph("Permanently delete these from " + caption.toLowerCase()
                + "? This takes effect on the controller immediately and cannot be undone."), ul);
        Button cancel = new Button("Cancel", e -> d.close());
        Button del = new Button("Delete " + targets.size(), VaadinIcon.TRASH.create());
        del.addThemeVariants(ButtonVariant.PRIMARY, ButtonVariant.ERROR);
        del.addClickListener(e -> {
            int deleted = 0;
            List<String> failures = new ArrayList<>();
            for (Map<String, Object> r : targets) {
                try {
                    deleter.delete(r);
                    deleted++;
                } catch (RuntimeException ex) {
                    failures.add(label(r) + ": " + ZitiException.text(ex));
                }
            }
            grid.asMultiSelect().clear();
            if (failures.isEmpty()) {
                d.close();
                Toast.success("Deleted " + deleted + " item" + (deleted == 1 ? "" : "s"), null);
            } else {
                d.removeAll();
                d.getFooter().removeAll();
                d.setHeaderTitle("Some items were not deleted");
                d.add(new Paragraph("Deleted " + deleted + ". These " + failures.size()
                        + " failed and are still on the controller:"), Ui.errors(failures));
                d.getFooter().add(new Button("Close", ev -> d.close()));
            }
        });
        d.getFooter().add(cancel, del);
        d.open();
    }
}
