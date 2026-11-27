package com.example.views;

import com.example.ui.MainLayout;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.Route;

/** "/" opens the Access Canvas, like the web console. */
@Route(value = "", layout = MainLayout.class)
public class RootView extends Div implements BeforeEnterObserver {

    public static String home = "access-canvas";

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        event.forwardTo(home);
    }
}
