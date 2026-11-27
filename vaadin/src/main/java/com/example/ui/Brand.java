package com.example.ui;

import com.vaadin.flow.component.Html;

/** The Baked Pasta ziti-in-marinara casserole dish mark; the dish follows the ink colour. */
public final class Brand {

    public static final String VERSION = "0.2.3";

    private Brand() {
    }

    public static Html mark(int size) {
        String id = "bpz" + size;
        return new Html("""
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="%1$d" height="%1$d" role="img" aria-label="Baked Pasta Console" style="flex:none">
                <defs><g id="%2$s">
                <path d="M0 -7 H20 A4 7 0 0 1 20 7 H0 Z" fill="#F2B544" stroke="#14302B" stroke-width="2.75" stroke-linejoin="round"/>
                <ellipse rx="4" ry="7" fill="#FBE3A6" stroke="#14302B" stroke-width="2.75"/>
                <ellipse rx="1.8" ry="3.7" fill="#14302B"/></g></defs>
                <use href="#%2$s" transform="translate(22 17) rotate(-12)"/>
                <path d="M27 12.6 Q33 10.8 39 9.6 Q42 9 42.5 11 Q43 13 41 14 Q40 16.5 38.5 15.5 Q37.5 14.8 36 15.6 Q33 18 31.5 16 Q30 15 28.6 16.4 Q26.5 17.5 26.3 15 Z" fill="#D9481C"/>
                <use href="#%2$s" transform="translate(8 28) rotate(4)"/>
                <use href="#%2$s" transform="translate(56 28) scale(-1 1) rotate(4)"/>
                <path d="M4 36 Q4 31 9 32 Q14 33 17 30.5 Q20 28 23 31 Q26 34 30 30.5 Q33 28 36 31 Q39 34 42 31 Q45 28 48 30.5 Q51 33 55 32 Q60 31 60 36 Z" fill="#D9481C"/>
                <rect x="1" y="35" width="62" height="7" rx="3.5" fill="var(--ac-ink)"/>
                <path d="M7 41 H57 L54 52 Q52.8 56 48.8 56 H15.2 Q11.2 56 10 52 Z" fill="var(--ac-ink)"/>
                </svg>""".formatted(size, id));
    }
}
