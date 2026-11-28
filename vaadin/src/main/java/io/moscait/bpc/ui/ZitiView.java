package io.moscait.bpc.ui;

import io.moscait.bpc.ziti.ZitiException;
import io.moscait.bpc.ziti.ZitiService;
import com.vaadin.flow.component.AttachEvent;
import com.vaadin.flow.component.DetachEvent;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.shared.Registration;

/**
 * Base for pages that show controller data: {@link #reload()} runs when the page is shown and
 * again whenever the session's data or connection changes.
 */
public abstract class ZitiView extends Div {

    protected final ZitiService ziti;
    private Registration sub;

    protected ZitiView(ZitiService ziti) {
        this.ziti = ziti;
        setSizeFull();
    }

    /** Loads (or re-loads) the page's data; failures are toasted by {@link #safeReload()}. */
    protected abstract void reload();

    protected void safeReload() {
        if (!ziti.isAuthenticated()) {
            return;
        }
        try {
            reload();
        } catch (RuntimeException e) {
            Toast.error("Failed to load data", ZitiException.text(e));
        }
    }

    @Override
    protected void onAttach(AttachEvent attachEvent) {
        super.onAttach(attachEvent);
        safeReload();
        sub = ziti.subscribe(this::safeReload);
    }

    @Override
    protected void onDetach(DetachEvent detachEvent) {
        if (sub != null) {
            sub.remove();
            sub = null;
        }
        super.onDetach(detachEvent);
    }
}
