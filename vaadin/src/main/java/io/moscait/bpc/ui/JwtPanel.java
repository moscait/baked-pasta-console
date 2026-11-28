package io.moscait.bpc.ui;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.Html;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Anchor;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.icon.VaadinIcon;
import com.vaadin.flow.component.textfield.TextArea;
import com.vaadin.flow.server.streams.DownloadHandler;
import com.vaadin.flow.server.streams.DownloadResponse;

/** An enrollment JWT with Download (.jwt), Copy and (optionally) a QR code. */
public class JwtPanel extends Div {

    public JwtPanel(String jwt, String fileName, String expiresAt) {
        getStyle().set("display", "flex").set("flex-direction", "column").set("gap", "8px");
        TextArea area = new TextArea();
        area.setValue(jwt);
        area.setReadOnly(true);
        area.setWidthFull();
        area.setMaxHeight("9rem");
        area.addClassName("bp-jwt");
        area.setAriaLabel("Enrollment JWT");
        add(area, actions(jwt, fileName, expiresAt));
    }

    public static Component actions(String jwt, String fileName, String expiresAt) {
        Div row = Ui.toolbar(download(jwt, fileName), copyButton(jwt, "Copy JWT"));
        if (expiresAt != null) {
            row.add(Ui.muted("Expires " + Ui.dateTime(expiresAt) + " (" + Ui.relative(expiresAt) + ")"));
        }
        return row;
    }

    public static Anchor download(String text, String fileName) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        Anchor a = new Anchor(DownloadHandler.fromInputStream(e -> new DownloadResponse(new ByteArrayInputStream(bytes),
                fileName + ".jwt", "application/jwt", bytes.length)), "");
        Button b = new Button("Download .jwt", VaadinIcon.DOWNLOAD_ALT.create());
        b.addThemeVariants(ButtonVariant.PRIMARY);
        a.add(b);
        return a;
    }

    /** Copies text to the clipboard in the browser; the server only sends the value with the click. */
    public static Button copyButton(String text, String label) {
        Button b = new Button(label, VaadinIcon.COPY_O.create());
        b.addClickListener(e -> {
            b.getElement().executeJs("navigator.clipboard && navigator.clipboard.writeText($0)", text);
            b.setText("Copied");
            b.setIcon(VaadinIcon.CHECK.create());
        });
        return b;
    }

    /** A QR code as inline SVG (black modules on a white quiet zone). */
    public static Component qr(String value, int size) {
        try {
            BitMatrix m = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0,
                    Map.of(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.L, EncodeHintType.MARGIN, 1));
            StringBuilder path = new StringBuilder();
            for (int y = 0; y < m.getHeight(); y++) {
                for (int x = 0; x < m.getWidth(); x++) {
                    if (m.get(x, y)) {
                        path.append('M').append(x).append(' ').append(y).append("h1v1h-1z");
                    }
                }
            }
            Html svg = new Html("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + m.getWidth() + " " + m.getHeight()
                    + "' width='" + size + "' height='" + size + "' shape-rendering='crispEdges' role='img' "
                    + "aria-label='Enrollment QR code'><rect width='100%' height='100%' fill='#fff'/><path fill='#000' d='"
                    + path + "'/></svg>");
            Div wrap = new Div(svg);
            wrap.addClassName("bp-qr");
            wrap.setWidth((size + 18) + "px");
            wrap.setHeight((size + 18) + "px");
            return wrap;
        } catch (WriterException e) {
            return Ui.muted("QR code unavailable: " + e.getMessage());
        }
    }
}
