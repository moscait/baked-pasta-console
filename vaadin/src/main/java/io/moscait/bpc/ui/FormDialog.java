package io.moscait.bpc.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.moscait.bpc.ziti.Json;
import io.moscait.bpc.ziti.ZitiException;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.dialog.Dialog;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H3;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.component.textfield.TextField;

/**
 * A create/edit dialog: fields, an error list, and Cancel / Save. {@code submit} validates and
 * saves; it adds messages to the error list to stay open, or throws (the message is shown).
 */
public class FormDialog extends Dialog {

    public interface Submit {
        void run(List<String> errors);
    }

    private final Div body = new Div();
    private final Div errorBox = new Div();
    private final Button save;

    public FormDialog(String title, String submitLabel, boolean wide, Submit submit) {
        setHeaderTitle(title);
        setWidth(wide ? "min(760px, 96vw)" : "min(520px, 96vw)");
        setCloseOnOutsideClick(false);
        body.addClassName("bp-form");
        errorBox.setVisible(false);
        add(body, errorBox);
        Button close = Ui.iconButton(com.vaadin.flow.component.icon.VaadinIcon.CLOSE, "Close", this::close);
        getHeader().add(close);
        Button cancel = new Button("Cancel", e -> close());
        save = new Button(submitLabel, e -> {
            List<String> errors = new ArrayList<>();
            try {
                submit.run(errors);
            } catch (RuntimeException ex) {
                errors.add(ZitiException.text(ex));
            }
            showErrors(errors);
            if (errors.isEmpty()) {
                close();
            }
        });
        save.addThemeVariants(ButtonVariant.PRIMARY);
        getFooter().add(cancel, save);
    }

    public FormDialog fields(Component... c) {
        body.add(c);
        return this;
    }

    public Button saveButton() {
        return save;
    }

    public void showErrors(List<String> errors) {
        errorBox.removeAll();
        errorBox.setVisible(!errors.isEmpty());
        if (!errors.isEmpty()) {
            errorBox.add(Ui.errors(errors));
        }
    }

    // ------------------------------------------------------------------ field helpers

    public static Div section(String title, Component... content) {
        H3 h = new H3(title);
        h.getStyle().set("font-size", "var(--aura-font-size-s)").set("margin", "8px 0 0").set("text-transform", "uppercase")
                .set("letter-spacing", "0.05em").set("color", "var(--ac-muted)");
        Div d = new Div(h);
        d.addClassName("bp-form");
        d.add(content);
        return d;
    }

    public static Div grid(Component... content) {
        Div d = new Div(content);
        d.addClassName("bp-form-grid");
        return d;
    }

    public static TextField text(String label, String value, String placeholder, String helper) {
        TextField f = new TextField(label);
        f.setValue(value == null ? "" : value);
        if (placeholder != null) {
            f.setPlaceholder(placeholder);
        }
        if (helper != null) {
            f.setHelperText(helper);
        }
        return f;
    }

    public static TextArea area(String label, String value, String helper, boolean mono) {
        TextArea a = new TextArea(label);
        a.setValue(value == null ? "" : value);
        a.setMinRows(3);
        a.setMaxHeight("16rem");
        if (helper != null) {
            a.setHelperText(helper);
        }
        if (mono) {
            a.addClassName("mono");
        }
        return a;
    }

    public static Checkbox check(String label, boolean value, String helper) {
        Checkbox c = new Checkbox(label, value);
        if (helper != null) {
            c.setHelperText(helper);
        }
        return c;
    }

    /** A Select of controller entities by id, labelled by name; "" means none. */
    public static Select<String> entitySelect(String label, List<Map<String, Object>> rows, String value,
            String emptyLabel) {
        Select<String> s = new Select<>();
        s.setLabel(label);
        List<String> ids = new ArrayList<>();
        if (emptyLabel != null) {
            ids.add("");
        }
        rows.forEach(r -> ids.add(Json.str(r, "id")));
        s.setItems(ids);
        s.setItemLabelGenerator(id -> {
            if (id == null || id.isEmpty()) {
                return emptyLabel == null ? "" : emptyLabel;
            }
            return rows.stream().filter(r -> id.equals(r.get("id"))).map(r -> Json.strOr(r, "name", id)).findFirst()
                    .orElse(id);
        });
        s.setValue(value == null ? (emptyLabel != null ? "" : null) : value);
        return s;
    }

    public static <T> Select<T> select(String label, List<T> items, T value,
            com.vaadin.flow.component.ItemLabelGenerator<T> labels) {
        Select<T> s = new Select<>();
        s.setLabel(label);
        s.setItems(items);
        if (labels != null) {
            s.setItemLabelGenerator(labels);
        }
        s.setValue(value);
        return s;
    }
}
