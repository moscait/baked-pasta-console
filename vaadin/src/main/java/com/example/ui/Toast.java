package com.example.ui;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.notification.Notification;
import com.vaadin.flow.component.notification.NotificationVariant;
import com.vaadin.flow.component.orderedlayout.FlexComponent;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;

/** Title + detail notifications, matching the web console's toast stack. */
public final class Toast {

    public enum Level {
        INFO, SUCCESS, WARNING, ERROR
    }

    private Toast() {
    }

    public static void info(String title, String detail) {
        show(Level.INFO, title, detail);
    }

    public static void success(String title, String detail) {
        show(Level.SUCCESS, title, detail);
    }

    public static void warning(String title, String detail) {
        show(Level.WARNING, title, detail);
    }

    public static void error(String title, String detail) {
        show(Level.ERROR, title, detail);
    }

    public static void show(Level level, String title, String detail) {
        Notification n = new Notification();
        n.setPosition(Notification.Position.BOTTOM_END);
        n.setDuration(level == Level.ERROR ? 8000 : 4800);
        n.addThemeVariants(switch (level) {
            case SUCCESS -> NotificationVariant.SUCCESS;
            case WARNING -> NotificationVariant.WARNING;
            case ERROR -> NotificationVariant.ERROR;
            default -> NotificationVariant.INFO;
        });
        Div text = new Div();
        Div t = new Div(title);
        t.addClassName("bp-strong");
        text.add(t);
        if (detail != null && !detail.isBlank()) {
            Div d = new Div(detail);
            d.addClassName("bp-small");
            d.getStyle().set("opacity", "0.85");
            text.add(d);
        }
        Button close = new Button(VaadinIcon.CLOSE_SMALL.create(), e -> n.close());
        close.addThemeVariants(ButtonVariant.TERTIARY);
        close.setAriaLabel("Dismiss notification");
        HorizontalLayout row = new HorizontalLayout(text, close);
        row.setAlignItems(FlexComponent.Alignment.START);
        row.setSpacing(true);
        n.add(row);
        n.open();
    }
}
