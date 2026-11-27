package com.example.ui;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.function.Consumer;

import com.example.ziti.ZitiException;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.confirmdialog.ConfirmDialog;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H1;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.Paragraph;
import com.vaadin.flow.component.html.Pre;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.icon.Icon;
import com.vaadin.flow.component.icon.VaadinIcon;

/** Small building blocks shared by the pages. */
public final class Ui {

    private Ui() {
    }

    public static Div pageHeader(String title, String subtitle) {
        Div d = new Div(new H1(title));
        d.addClassName("bp-page-header");
        if (subtitle != null) {
            d.add(new Paragraph(subtitle));
        }
        return d;
    }

    public static Div card(Component... content) {
        Div d = new Div(content);
        d.addClassName("bp-card");
        return d;
    }

    public static Div card(String title, String lead, Component... content) {
        Div d = new Div();
        d.addClassName("bp-card");
        d.add(new H2(title));
        if (lead != null) {
            Paragraph p = new Paragraph(lead);
            p.addClassName("lead");
            d.add(p);
        }
        Div body = new Div(content);
        body.getStyle().set("margin-top", "var(--vaadin-gap-m)");
        d.add(body);
        return d;
    }

    public static Div page(Component... content) {
        Div d = new Div(content);
        d.addClassName("bp-page");
        return d;
    }

    public static Span chip(String text, String variant) {
        Span s = new Span(text);
        s.addClassName("bp-chip");
        if (variant != null) {
            s.addClassName(variant);
        }
        return s;
    }

    public static Div chips(List<String> items, String variant, String prefix) {
        Div d = new Div();
        d.addClassName("bp-chips");
        if (items == null || items.isEmpty()) {
            Span none = new Span("—");
            none.addClassName("bp-muted");
            d.add(none);
        } else {
            items.forEach(i -> d.add(chip(prefix + i, variant)));
        }
        return d;
    }

    public static Div attrChips(List<String> attrs) {
        return chips(attrs, "attr", "#");
    }

    /** Role strings (#attr, @name, #all) as chips. */
    public static Div roleChips(List<String> roles) {
        Div d = new Div();
        d.addClassName("bp-chips");
        if (roles == null || roles.isEmpty()) {
            Span none = new Span("none");
            none.addClassNames("bp-muted", "bp-small");
            d.add(none);
        }
        for (String r : roles == null ? List.<String>of() : roles) {
            d.add(chip(r, r.startsWith("@") ? null : "attr"));
        }
        return d;
    }

    public static Span muted(String text) {
        Span s = new Span(text);
        s.addClassName("bp-muted");
        return s;
    }

    public static Span mono(String text) {
        Span s = new Span(text == null ? "" : text);
        s.addClassName("bp-mono");
        return s;
    }

    public static Span strong(String text) {
        Span s = new Span(text);
        s.addClassName("bp-strong");
        return s;
    }

    public static Div callout(String kind, Component... content) {
        Div d = new Div(content);
        d.addClassName("bp-callout");
        if (kind != null) {
            d.addClassName(kind);
        }
        return d;
    }

    public static Div callout(String kind, String text) {
        return callout(kind, new Span(text));
    }

    public static Div errors(List<String> errors) {
        Div d = new Div();
        d.addClassNames("bp-callout", "error");
        d.getElement().setAttribute("role", "alert");
        d.setVisible(!errors.isEmpty());
        if (errors.size() == 1) {
            d.add(new Span(errors.getFirst()));
        } else if (!errors.isEmpty()) {
            var ul = new com.vaadin.flow.component.html.UnorderedList();
            errors.forEach(e -> ul.add(new com.vaadin.flow.component.html.ListItem(e)));
            d.add(ul);
        }
        return d;
    }

    public static Pre pre(String text) {
        Pre p = new Pre(text);
        p.addClassName("bp-pre");
        return p;
    }

    public static Button primary(String label, VaadinIcon icon, Runnable onClick) {
        Button b = new Button(label, icon == null ? null : icon.create(), e -> run(onClick));
        b.addThemeVariants(ButtonVariant.PRIMARY);
        return b;
    }

    /** A null action is allowed: the button is then only a visual (e.g. inside an Anchor or Upload). */
    private static void run(Runnable r) {
        if (r != null) {
            r.run();
        }
    }

    public static Button button(String label, VaadinIcon icon, Runnable onClick) {
        return new Button(label, icon == null ? null : icon.create(), e -> run(onClick));
    }

    public static Button small(String label, VaadinIcon icon, Runnable onClick) {
        Button b = button(label, icon, onClick);
        b.addThemeVariants(ButtonVariant.SMALL);
        return b;
    }

    public static Button iconButton(VaadinIcon icon, String label, Runnable onClick) {
        Button b = new Button(icon.create(), e -> run(onClick));
        b.addThemeVariants(ButtonVariant.TERTIARY, ButtonVariant.SMALL);
        b.setAriaLabel(label);
        b.setTooltipText(label);
        return b;
    }

    public static Icon icon(VaadinIcon icon, String color) {
        Icon i = icon.create();
        i.getStyle().set("color", color).set("width", "18px").set("height", "18px");
        return i;
    }

    public static Div spacer() {
        Div d = new Div();
        d.addClassName("bp-spacer");
        return d;
    }

    public static Div toolbar(Component... content) {
        Div d = new Div(content);
        d.addClassName("bp-toolbar");
        return d;
    }

    /** Runs an action, toasting its failure; returns false on failure. */
    public static boolean attempt(String failureTitle, Runnable action) {
        try {
            action.run();
            return true;
        } catch (RuntimeException e) {
            Toast.error(failureTitle, ZitiException.text(e));
            return false;
        }
    }

    public static void confirm(String header, String text, String confirmLabel, boolean danger, Runnable onConfirm) {
        ConfirmDialog d = new ConfirmDialog();
        d.setHeader(header);
        d.setText(text);
        d.setCancelable(true);
        d.setConfirmText(confirmLabel);
        if (danger) {
            d.setConfirmButtonTheme("error primary");
        }
        d.addConfirmListener(e -> onConfirm.run());
        d.open();
    }

    // ------------------------------------------------------------------ time formatting

    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
            .withZone(ZoneId.systemDefault());

    public static Instant parseInstant(String iso) {
        if (iso == null || iso.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(iso);
        } catch (RuntimeException e) {
            try {
                return java.time.OffsetDateTime.parse(iso).toInstant();
            } catch (RuntimeException e2) {
                return null;
            }
        }
    }

    public static String dateTime(String iso) {
        Instant i = parseInstant(iso);
        return i == null ? "—" : DATE_TIME.format(i);
    }

    /** "5m ago", "in 3h", … */
    public static String relative(String iso) {
        Instant i = parseInstant(iso);
        if (i == null) {
            return "—";
        }
        long secs = Duration.between(Instant.now(), i).getSeconds();
        String span = humanSpan(Math.abs(secs));
        return secs >= 0 ? "in " + span : span + " ago";
    }

    public static String humanSpan(long secs) {
        if (secs < 60) {
            return secs + "s";
        }
        if (secs < 3600) {
            return (secs / 60) + "m";
        }
        if (secs < 86400) {
            return (secs / 3600) + "h";
        }
        return (secs / 86400) + "d";
    }

    public static <T> Consumer<T> noop() {
        return t -> {
        };
    }

    public static String plural(int n, String one) {
        return n + " " + one + (n == 1 ? "" : "s");
    }
}
