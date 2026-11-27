package com.example.configbuilder;

/**
 * One validation finding. {@code level} is "error" or "warn"; {@code field} is the model path
 * (e.g. {@code ctrl.listener}) so the form can flag the input, or null for section-level issues.
 */
public record ValidationIssue(String section, String level, String message, String field) {

    public boolean isError() {
        return "error".equals(level);
    }
}
