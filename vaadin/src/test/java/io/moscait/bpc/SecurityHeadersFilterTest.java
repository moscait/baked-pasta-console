package io.moscait.bpc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SecurityHeadersFilterTest {

    private static MockHttpServletResponse filter(boolean secure) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/");
        req.setSecure(secure);
        MockHttpServletResponse resp = new MockHttpServletResponse();
        new SecurityHeadersFilter().doFilter(req, resp, new MockFilterChain());
        return resp;
    }

    @Test
    void refusesToBeFramed() throws Exception {
        MockHttpServletResponse resp = filter(false);
        assertEquals("DENY", resp.getHeader("X-Frame-Options"));
        assertTrue(resp.getHeader("Content-Security-Policy").contains("frame-ancestors 'none'"));
        assertEquals("nosniff", resp.getHeader("X-Content-Type-Options"));
    }

    @Test
    void sendsHstsOnlyOverHttps() throws Exception {
        assertNull(filter(false).getHeader("Strict-Transport-Security"));
        assertEquals("max-age=31536000", filter(true).getHeader("Strict-Transport-Security"));
    }
}
