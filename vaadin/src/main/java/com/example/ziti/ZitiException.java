package com.example.ziti;

/** A controller call failed; the message is fit to show to the user. */
public class ZitiException extends RuntimeException {

    private final int status;

    public ZitiException(String message) {
        this(message, 0, null);
    }

    public ZitiException(String message, int status, Throwable cause) {
        super(message, cause);
        this.status = status;
    }

    public int status() {
        return status;
    }

    /** Best-effort human-readable text for any throwable. */
    public static String text(Throwable err) {
        if (err == null) {
            return "Unexpected error";
        }
        String msg = err.getMessage();
        if (msg != null && !msg.isBlank()) {
            return msg;
        }
        return err.getClass().getSimpleName();
    }
}
