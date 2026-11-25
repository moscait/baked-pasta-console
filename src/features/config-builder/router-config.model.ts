/*
    Copyright NetFoundry Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

// Ported unchanged in behaviour from openziti/ziti-console 4.8.1
// (projects/ziti-console-lib/src/lib/pages/config-builder/router-config.model.ts), Apache-2.0.
// Retyped for this console: parsed documents are `YamlMap`s read through narrowing helpers
// instead of `any`; emitted YAML is unchanged (see config-builder.roundtrip.spec.ts).

// Model, validation and YAML emitter for an OpenZiti router config (`v: 3`).
// Key names follow router/env/config.go and the `ziti create config router` template.
// Unlike the controller model, an ingested document is edited in place, so anything the form does not
// manage (transport.ws tuning, forwarder.latencyProbeInterval, plugins, ...) survives a save untouched.

import {parse as parseYaml} from 'yaml';
import {
    ValidationIssue,
    checkEndpoint,
    checkHostPort,
    checkPath,
    dumpDocument,
    parseDuration,
} from './controller-config.model';
import {YamlMap, YamlValue, asList, asMap, cloneMap, get, isObj, str} from './yaml-value';

export type TunnelMode = 'tproxy' | 'host' | 'proxy';
export type ConfigKind = 'controller' | 'router';

export interface RouterConfig {
    /** Parsed source document when a file was ingested. */
    base?: YamlMap;
    /** The source listed controllers under `ctrl.endpoints` rather than the single `ctrl.endpoint`. */
    ctrlList: boolean;
    /** The source kept its CSR at top level (fabric-only template) instead of under `edge`. */
    csrTop: boolean;
    identity: { cert: string; serverCert: string; key: string; ca: string };
    ctrl: { endpoints: string[]; endpointsFile: string };
    link: {
        dial: boolean;
        listen: boolean;
        bind: string;
        advertise: string;
        outQueueSize: number | null;
        /** `groups` on the transport dialer: only dial listeners that share a group. */
        dialGroups: string[];
        /** `groups` on the transport listener: the groups this listener belongs to. */
        listenGroups: string[];
    };
    edge: {
        enabled: boolean;
        address: string;
        advertise: string;
        connectTimeoutMs: number | null;
        getSessionTimeout: number | null;
    };
    /** Bindings of listeners the form does not model (e.g. edge_wss, proxy). Kept as-is on save. */
    otherListeners: string[];
    tunnel: { enabled: boolean; mode: TunnelMode; resolver: string; lanIf: string; dnsSvcIpRange: string };
    csr: {
        country: string;
        province: string;
        locality: string;
        organization: string;
        organizationalUnit: string;
        dns: string[];
        ip: string[];
    };
    forwarder: {
        xgressDialQueueLength: number | null;
        xgressDialWorkerCount: number | null;
        linkDialQueueLength: number | null;
        linkDialWorkerCount: number | null;
    };
    metrics: { reportInterval: string; messageQueueSize: number | null };
    health: {
        ctrlPingInterval: string;
        ctrlPingTimeout: string;
        ctrlPingInitialDelay: string;
        minLinks: number | null;
    };
}

export const TUNNEL_MODES: { id: TunnelMode; label: string; hint: string }[] = [
    {id: 'tproxy', label: 'tproxy', hint: 'Intercept traffic for services on this host (Linux). Needs root or CAP_NET_ADMIN.'},
    {id: 'host', label: 'host', hint: 'Host services: dial out to servers reachable from this router.'},
    {id: 'proxy', label: 'proxy', hint: 'Listen on explicit local ports for services.'},
];

export function defaultRouterConfig(): RouterConfig {
    return {
        ctrlList: false,
        csrTop: false,
        identity: {
            cert: './pki/router/certs/client.cert',
            serverCert: './pki/router/certs/server.cert',
            key: './pki/router/keys/server.key',
            ca: './pki/router/cas.cert',
        },
        ctrl: {endpoints: ['tls:ctrl.example.com:6262'], endpointsFile: './endpoints.yml'},
        link: {dial: true, listen: true, bind: 'tls:0.0.0.0:10080', advertise: 'tls:router.example.com:10080',
            outQueueSize: null, dialGroups: [], listenGroups: []},
        edge: {enabled: true, address: 'tls:0.0.0.0:3022', advertise: 'router.example.com:3022',
            connectTimeoutMs: null, getSessionTimeout: null},
        otherListeners: [],
        tunnel: {enabled: false, mode: 'host', resolver: '', lanIf: '', dnsSvcIpRange: ''},
        csr: {country: 'US', province: 'NC', locality: 'Charlotte', organization: 'NetFoundry',
            organizationalUnit: 'Ziti', dns: ['localhost', 'router.example.com'], ip: ['127.0.0.1', '::1']},
        forwarder: {xgressDialQueueLength: null, xgressDialWorkerCount: null, linkDialQueueLength: null,
            linkDialWorkerCount: null},
        metrics: {reportInterval: '', messageQueueSize: null},
        health: {ctrlPingInterval: '', ctrlPingTimeout: '', ctrlPingInitialDelay: '', minLinks: null},
    };
}

// ---- detection ---------------------------------------------------------------------------------

/**
 * Decide whether a parsed config belongs to a controller or a router.
 * Both use `v: 3`, `identity` and `ctrl`, so the call rests on keys only one of them has.
 */
export function detectKind(doc: unknown): ConfigKind | 'unknown' {
    if (!isObj(doc)) {
        return 'unknown';
    }
    const has = (k: string) => k in doc;
    const edge = asMap(doc.edge);
    const ctrl = asMap(doc.ctrl);
    let controller = 0;
    let router = 0;
    ['db', 'cluster', 'web', 'network', 'events', 'trustDomain', 'healthChecks'].forEach(k => has(k) && controller++);
    if (edge.api || edge.enrollment) {
        controller += 2;
    }
    if (ctrl.listener) {
        controller += 2;
    }
    ['link', 'listeners', 'forwarder', 'csr', 'dialers'].forEach(k => has(k) && router++);
    if (edge.csr) {
        router += 2;
    }
    if (ctrl.endpoint || ctrl.endpoints || ctrl.endpointsFile) {
        router += 2;
    }
    if (controller === router) {
        return 'unknown';
    }
    return controller > router ? 'controller' : 'router';
}

// ---- validation --------------------------------------------------------------------------------

const ENV_REF = /\$\{[^}]+\}/;
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9])?$/;
const IP = /^(\d{1,3}(\.\d{1,3}){3}|[0-9A-Fa-f:]+:[0-9A-Fa-f:.]*)$/;
const CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

export function validateRouter(c: RouterConfig): ValidationIssue[] {
    const out: ValidationIssue[] = [];
    const err = (section: string, message: string, field?: string) =>
        out.push({section, level: 'error', message, field});
    const warn = (section: string, message: string, field?: string) =>
        out.push({section, level: 'warn', message, field});
    const path = (section: string, label: string, v: string, field: string, required = true) => {
        if (!v) {
            if (required) {
                err(section, `${label} is required`, field);
            }
            return;
        }
        const p = checkPath(v);
        if (p) {
            err(section, `${label} ${p}`, field);
        }
    };
    const optInt = (section: string, label: string, v: number | null, min: number, max: number, field: string) => {
        if (v === null || v === undefined) {
            return;
        }
        if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
            err(section, `${label} must be a whole number from ${min} to ${max}`, field);
        }
    };
    const optDuration = (section: string, label: string, v: string, field: string) => {
        if (v && isNaN(parseDuration(v))) {
            err(section, `${label} is not a valid duration (try 30s, 5m)`, field);
        }
    };

    path('r-identity', 'identity.cert', c.identity.cert, 'identity.cert');
    path('r-identity', 'identity.server_cert', c.identity.serverCert, 'identity.serverCert', false);
    path('r-identity', 'identity.key', c.identity.key, 'identity.key');
    path('r-identity', 'identity.ca', c.identity.ca, 'identity.ca');

    // controller connection
    const eps = c.ctrl.endpoints.filter(e => e !== '');
    if (!eps.length && !c.ctrl.endpointsFile) {
        err('r-ctrl', 'give at least one controller endpoint or an endpoints file');
    }
    c.ctrl.endpoints.forEach((e, i) => {
        if (!e) {
            err('r-ctrl', `controller endpoint ${i + 1} is empty`);
            return;
        }
        const p = checkEndpoint(e);
        if (p) {
            err('r-ctrl', `controller endpoint ${i + 1} ${p}`);
        } else if (!ENV_REF.test(e) && !e.startsWith('tls:')) {
            warn('r-ctrl', `controller endpoint ${i + 1}: controllers normally listen on tls:`);
        }
    });
    if (new Set(eps).size !== eps.length) {
        err('r-ctrl', 'the same controller endpoint is listed twice');
    }
    path('r-ctrl', 'endpoints file', c.ctrl.endpointsFile, 'ctrl.endpointsFile', false);

    // links
    if (c.link.listen) {
        const b = checkEndpoint(c.link.bind);
        if (!c.link.bind) {
            err('r-link', 'link listener bind address is required', 'link.bind');
        } else if (b) {
            err('r-link', `link listener bind ${b}`, 'link.bind');
        }
        if (!c.link.advertise) {
            err('r-link', 'link listener advertise address is required: other routers dial it', 'link.advertise');
        } else {
            const a = checkEndpoint(c.link.advertise);
            if (a) {
                err('r-link', `link listener advertise ${a}`, 'link.advertise');
            }
        }
        optInt('r-link', 'outQueueSize', c.link.outQueueSize, 1, 1000000, 'link.outQueueSize');
    }
    if (!c.link.listen && !c.link.dial) {
        warn('r-link', 'with neither a link dialer nor a link listener this router cannot form links');
    }

    // edge and tunnel
    if (c.edge.enabled) {
        if (!c.edge.address) {
            err('r-edge', 'edge listener address is required', 'edge.address');
        } else if (!ENV_REF.test(c.edge.address)) {
            const scheme = c.edge.address.split(':')[0];
            if (scheme !== 'tls' && scheme !== 'wss') {
                err('r-edge', 'edge listener address must start with tls: or wss:', 'edge.address');
            } else {
                const p = checkEndpoint(c.edge.address);
                if (p) {
                    err('r-edge', `edge listener address ${p}`, 'edge.address');
                }
            }
        }
        if (!c.edge.advertise) {
            err('r-edge', 'edge advertise is required: SDKs connect to it', 'edge.advertise');
        } else {
            const p = checkHostPort(c.edge.advertise);
            if (p) {
                err('r-edge', `edge advertise ${p}`, 'edge.advertise');
            }
        }
        optInt('r-edge', 'connectTimeoutMs', c.edge.connectTimeoutMs, 1, 600000, 'edge.connectTimeoutMs');
        optInt('r-edge', 'getSessionTimeout', c.edge.getSessionTimeout, 1, 3600, 'edge.getSessionTimeout');
    }
    if (c.tunnel.enabled) {
        if (c.tunnel.mode === 'tproxy' && c.tunnel.resolver && !ENV_REF.test(c.tunnel.resolver) &&
            !/^(udp|tcp):\/\/.+:\d+$/.test(c.tunnel.resolver)) {
            err('r-edge', 'resolver must look like udp://100.64.0.1:53', 'tunnel.resolver');
        }
        if (c.tunnel.dnsSvcIpRange && !ENV_REF.test(c.tunnel.dnsSvcIpRange) && !CIDR.test(c.tunnel.dnsSvcIpRange)) {
            err('r-edge', 'dnsSvcIpRange must be a CIDR such as 100.64.0.1/10', 'tunnel.dnsSvcIpRange');
        }
        if (c.tunnel.lanIf && !/^[A-Za-z0-9_.:-]+$/.test(c.tunnel.lanIf)) {
            err('r-edge', 'lanIf must be an interface name', 'tunnel.lanIf');
        }
    }
    if (!c.edge.enabled && !c.tunnel.enabled && !c.otherListeners.some(b => /^(edge|tunnel)/.test(b))) {
        warn('r-edge', 'no edge or tunnel listener: SDKs and tunnelers cannot use this as an edge router');
    }

    // CSR
    if (c.edge.enabled || c.tunnel.enabled) {
        if (c.csr.country && !/^[A-Za-z]{2}$/.test(c.csr.country)) {
            err('r-csr', 'country must be a two-letter code', 'csr.country');
        }
        c.csr.dns.forEach((d, i) => {
            if (!d || (!ENV_REF.test(d) && !HOSTNAME.test(d))) {
                err('r-csr', `DNS SAN ${i + 1} is not a valid hostname`);
            }
        });
        c.csr.ip.forEach((ip, i) => {
            if (!ip || (!ENV_REF.test(ip) && !(IP.test(ip) && ip.split('.').every(p => !/^\d+$/.test(p) || +p <= 255)))) {
                err('r-csr', `IP SAN ${i + 1} is not a valid address`);
            }
        });
        if (!c.csr.dns.length && !c.csr.ip.length) {
            warn('r-csr', 'no SANs: clients cannot verify this router by name or address');
        }
    }

    // advanced
    const f = c.forwarder;
    optInt('r-advanced', 'xgressDialQueueLength', f.xgressDialQueueLength, 1, 1000000, 'forwarder.xgressDialQueueLength');
    optInt('r-advanced', 'xgressDialWorkerCount', f.xgressDialWorkerCount, 1, 100000, 'forwarder.xgressDialWorkerCount');
    optInt('r-advanced', 'linkDialQueueLength', f.linkDialQueueLength, 1, 1000000, 'forwarder.linkDialQueueLength');
    optInt('r-advanced', 'linkDialWorkerCount', f.linkDialWorkerCount, 1, 100000, 'forwarder.linkDialWorkerCount');
    optDuration('r-advanced', 'metrics reportInterval', c.metrics.reportInterval, 'metrics.reportInterval');
    optInt('r-advanced', 'metrics messageQueueSize', c.metrics.messageQueueSize, 1, 1000000, 'metrics.messageQueueSize');
    optDuration('r-advanced', 'ctrlPingCheck interval', c.health.ctrlPingInterval, 'health.ctrlPingInterval');
    optDuration('r-advanced', 'ctrlPingCheck timeout', c.health.ctrlPingTimeout, 'health.ctrlPingTimeout');
    optDuration('r-advanced', 'ctrlPingCheck initialDelay', c.health.ctrlPingInitialDelay, 'health.ctrlPingInitialDelay');
    optInt('r-advanced', 'linkCheck minLinks', c.health.minLinks, 0, 1000, 'health.minLinks');
    return out;
}

// ---- document building -------------------------------------------------------------------------

/** Set `obj[key]`, or remove it when the value is empty. */
function setOrDel(obj: YamlMap, key: string, value: YamlValue | undefined) {
    if (value === '' || value === null || value === undefined) {
        delete obj[key];
    } else {
        obj[key] = value;
    }
}

/** Trimmed, non-empty entries, or '' (so `setOrDel` drops the key) when none are left. */
function cleanList(list: string[]): string[] | '' {
    const out = list.map(x => x.trim()).filter(x => x !== '');
    return out.length ? out : '';
}

/** Find the entry with `binding` in a list, or add one, and return it; null removes it. */
function upsertBinding(list: YamlValue[], binding: string, enabled: boolean): YamlMap | null {
    const i = list.findIndex(x => isObj(x) && x.binding === binding);
    if (!enabled) {
        if (i >= 0) {
            list.splice(i, 1);
        }
        return null;
    }
    const found = list[i];
    if (isObj(found)) {
        return found;
    }
    const entry: YamlMap = {binding};
    list.push(entry);
    return entry;
}

/** Drop `obj[key]` when it is an empty map or list. */
function prune(obj: YamlMap, key: string) {
    const v = obj[key];
    if ((isObj(v) && !Object.keys(v).length) || (Array.isArray(v) && !v.length)) {
        delete obj[key];
    }
}

/** `parent[key]` as a map, replacing anything else there with an empty one. */
function mapIn(parent: YamlMap, key: string): YamlMap {
    const m = asMap(parent[key]);
    parent[key] = m;
    return m;
}

export function buildRouterDocument(c: RouterConfig): YamlMap {
    const doc: YamlMap = c.base ? cloneMap(c.base) : {};
    if (doc.v === undefined) {
        doc.v = 3;
    }

    // identity
    const identity = mapIn(doc, 'identity');
    identity.cert = c.identity.cert;
    setOrDel(identity, 'server_cert', c.identity.serverCert);
    identity.key = c.identity.key;
    identity.ca = c.identity.ca;

    // ctrl: one controller reads naturally as `endpoint`, several need `endpoints`
    const ctrl = mapIn(doc, 'ctrl');
    const eps = c.ctrl.endpoints.filter(e => e !== '');
    delete ctrl.endpoint;
    delete ctrl.endpoints;
    if (eps.length === 1 && !c.ctrlList) {
        ctrl.endpoint = eps[0];
    } else if (eps.length) {
        ctrl.endpoints = eps;
    }
    setOrDel(ctrl, 'endpointsFile', c.ctrl.endpointsFile);

    // link
    const link = asMap(doc.link);
    const dialers = asList(link.dialers);
    const lListeners = asList(link.listeners);
    const dl = upsertBinding(dialers, 'transport', c.link.dial);
    if (dl) {
        setOrDel(dl, 'groups', cleanList(c.link.dialGroups));
    }
    const ll = upsertBinding(lListeners, 'transport', c.link.listen);
    if (ll) {
        setOrDel(ll, 'groups', cleanList(c.link.listenGroups));
        ll.bind = c.link.bind;
        ll.advertise = c.link.advertise;
        setOrDel(mapIn(ll, 'options'), 'outQueueSize', c.link.outQueueSize);
        prune(ll, 'options');
    }
    link.dialers = dialers;
    link.listeners = lListeners;
    prune(link, 'dialers');
    prune(link, 'listeners');
    doc.link = link;
    prune(doc, 'link');

    // edge + tunnel listeners
    const listeners = asList(doc.listeners);
    const el = upsertBinding(listeners, 'edge', c.edge.enabled);
    if (el) {
        el.address = c.edge.address;
        const options = mapIn(el, 'options');
        options.advertise = c.edge.advertise;
        setOrDel(options, 'connectTimeoutMs', c.edge.connectTimeoutMs);
        setOrDel(options, 'getSessionTimeout', c.edge.getSessionTimeout);
    }
    const tl = upsertBinding(listeners, 'tunnel', c.tunnel.enabled);
    if (tl) {
        const options = mapIn(tl, 'options');
        options.mode = c.tunnel.mode;
        const tproxy = c.tunnel.mode === 'tproxy';
        setOrDel(options, 'resolver', tproxy ? c.tunnel.resolver : '');
        setOrDel(options, 'lanIf', tproxy ? c.tunnel.lanIf : '');
        setOrDel(options, 'dnsSvcIpRange', tproxy ? c.tunnel.dnsSvcIpRange : '');
    }
    doc.listeners = listeners;
    prune(doc, 'listeners');

    // CSR lives under `edge` (the fabric-only template keeps it at top level)
    const wantCsr = c.edge.enabled || c.tunnel.enabled;
    const holder = c.csrTop ? doc : mapIn(doc, 'edge');
    if (wantCsr) {
        const csr = asMap(holder.csr);
        setOrDel(csr, 'country', c.csr.country);
        setOrDel(csr, 'province', c.csr.province);
        setOrDel(csr, 'locality', c.csr.locality);
        setOrDel(csr, 'organization', c.csr.organization);
        setOrDel(csr, 'organizationalUnit', c.csr.organizationalUnit);
        const sans = mapIn(csr, 'sans');
        setOrDel(sans, 'dns', c.csr.dns.length ? c.csr.dns : '');
        setOrDel(sans, 'ip', c.csr.ip.length ? c.csr.ip : '');
        prune(csr, 'sans');
        holder.csr = csr;
    }
    // with no form-managed listener, any CSR in the source belongs to a listener the form does not model: keep it
    if (!c.csrTop) {
        prune(doc, 'edge');
    }

    // advanced
    const fwd = asMap(doc.forwarder);
    setOrDel(fwd, 'xgressDialQueueLength', c.forwarder.xgressDialQueueLength);
    setOrDel(fwd, 'xgressDialWorkerCount', c.forwarder.xgressDialWorkerCount);
    setOrDel(fwd, 'linkDialQueueLength', c.forwarder.linkDialQueueLength);
    setOrDel(fwd, 'linkDialWorkerCount', c.forwarder.linkDialWorkerCount);
    doc.forwarder = fwd;
    prune(doc, 'forwarder');

    const met = asMap(doc.metrics);
    setOrDel(met, 'reportInterval', c.metrics.reportInterval);
    setOrDel(met, 'messageQueueSize', c.metrics.messageQueueSize);
    doc.metrics = met;
    prune(doc, 'metrics');

    const hc = asMap(doc.healthChecks);
    const ping = asMap(hc.ctrlPingCheck);
    setOrDel(ping, 'interval', c.health.ctrlPingInterval);
    setOrDel(ping, 'timeout', c.health.ctrlPingTimeout);
    setOrDel(ping, 'initialDelay', c.health.ctrlPingInitialDelay);
    hc.ctrlPingCheck = ping;
    prune(hc, 'ctrlPingCheck');
    const lc = asMap(hc.linkCheck);
    setOrDel(lc, 'minLinks', c.health.minLinks);
    hc.linkCheck = lc;
    prune(hc, 'linkCheck');
    doc.healthChecks = hc;
    prune(doc, 'healthChecks');

    // fresh documents keep a readable section order
    if (!c.base) {
        const order = ['v', 'identity', 'ctrl', 'link', 'listeners', 'edge', 'csr', 'forwarder', 'metrics', 'healthChecks'];
        const sorted: YamlMap = {};
        order.forEach(k => k in doc && (sorted[k] = doc[k]));
        Object.keys(doc).forEach(k => k in sorted || (sorted[k] = doc[k]));
        return sorted;
    }
    return doc;
}

export function routerToYaml(c: RouterConfig): string {
    return dumpDocument(buildRouterDocument(c), [
        '# OpenZiti router configuration',
        '# Generated by Baked Pasta Console Config Builder. Review before use; ${ENV_VARS} are expanded by the router.',
    ]);
}

// ---- ingest ------------------------------------------------------------------------------------

const isTunnelMode = (v: YamlValue | undefined): v is TunnelMode => TUNNEL_MODES.some(m => m.id === v);

export function routerFromDocument(doc: YamlMap): { cfg: RouterConfig; warnings: string[] } {
    const warnings: string[] = [];
    if (doc.v !== 3) {
        warnings.push(`config version is ${doc.v ?? 'missing'}; routers expect v: 3`);
    }
    const c = defaultRouterConfig();
    c.base = doc;
    const s = str;
    const n = (v: YamlValue | undefined): number | null => (typeof v === 'number' ? v : null);
    const strs = (v: YamlValue | undefined): string[] => asList(v).map(x => String(x));

    const id = asMap(doc.identity);
    c.identity = {cert: s(id.cert), serverCert: s(id.server_cert), key: s(id.key), ca: s(id.ca)};

    const ctrl = asMap(doc.ctrl);
    c.ctrlList = Array.isArray(ctrl.endpoints);
    c.ctrl = {
        endpoints: c.ctrlList ? strs(ctrl.endpoints) : (ctrl.endpoint ? [s(ctrl.endpoint)] : []),
        endpointsFile: s(ctrl.endpointsFile),
    };

    const link = asMap(doc.link);
    const find = (list: YamlValue | undefined, binding: string) =>
        asList(list).find((x): x is YamlMap => isObj(x) && x.binding === binding);
    const ll = find(link.listeners, 'transport');
    const dl = find(link.dialers, 'transport');
    c.link = {
        dial: !!dl,
        dialGroups: strs(dl?.groups),
        listenGroups: strs(ll?.groups),
        listen: !!ll,
        bind: s(ll?.bind),
        advertise: s(ll?.advertise),
        outQueueSize: n(get(ll, 'options', 'outQueueSize')),
    };
    if (asList(link.dialers).some(d => get(d, 'binding') !== 'transport')) {
        warnings.push('kept non-transport link dialers as-is');
    }

    const el = find(doc.listeners, 'edge');
    const eo = asMap(el?.options);
    c.edge = {
        enabled: !!el,
        address: s(el?.address),
        advertise: s(eo.advertise),
        connectTimeoutMs: n(eo.connectTimeoutMs),
        getSessionTimeout: n(eo.getSessionTimeout),
    };
    const tl = find(doc.listeners, 'tunnel');
    const to = asMap(tl?.options);
    c.tunnel = {
        enabled: !!tl,
        mode: isTunnelMode(to.mode) ? to.mode : 'tproxy',
        resolver: s(to.resolver),
        lanIf: s(to.lanIf),
        dnsSvcIpRange: s(to.dnsSvcIpRange),
    };
    const others = asList(doc.listeners).map(x => get(x, 'binding')).filter(b => b !== 'edge' && b !== 'tunnel');
    c.otherListeners = others.map(String);
    if (others.length) {
        warnings.push(`kept other listeners as-is: ${others.join(', ')}`);
    }

    c.csrTop = !isObj(get(doc, 'edge', 'csr')) && isObj(doc.csr);
    const csr = asMap(c.csrTop ? doc.csr : get(doc, 'edge', 'csr'));
    c.csr = {
        country: s(csr.country), province: s(csr.province), locality: s(csr.locality),
        organization: s(csr.organization), organizationalUnit: s(csr.organizationalUnit),
        dns: strs(get(csr, 'sans', 'dns')), ip: strs(get(csr, 'sans', 'ip')),
    };

    const f = asMap(doc.forwarder);
    c.forwarder = {
        xgressDialQueueLength: n(f.xgressDialQueueLength),
        xgressDialWorkerCount: n(f.xgressDialWorkerCount),
        linkDialQueueLength: n(f.linkDialQueueLength),
        linkDialWorkerCount: n(f.linkDialWorkerCount),
    };
    c.metrics = {reportInterval: s(get(doc, 'metrics', 'reportInterval')), messageQueueSize: n(get(doc, 'metrics', 'messageQueueSize'))};
    c.health = {
        ctrlPingInterval: s(get(doc, 'healthChecks', 'ctrlPingCheck', 'interval')),
        ctrlPingTimeout: s(get(doc, 'healthChecks', 'ctrlPingCheck', 'timeout')),
        ctrlPingInitialDelay: s(get(doc, 'healthChecks', 'ctrlPingCheck', 'initialDelay')),
        minLinks: n(get(doc, 'healthChecks', 'linkCheck', 'minLinks')),
    };

    const managed = ['v', 'identity', 'ctrl', 'link', 'listeners', 'edge', 'csr', 'forwarder', 'metrics', 'healthChecks'];
    const extra = Object.keys(doc).filter(k => !managed.includes(k));
    if (extra.length) {
        warnings.push(`passing through untouched: ${extra.join(', ')}`);
    }
    return {cfg: c, warnings};
}

export function parseConfigText(text: string): YamlMap {
    const doc: unknown = parseYaml(text);
    if (!isObj(doc)) {
        throw new Error('The file is not a YAML mapping');
    }
    return doc;
}
