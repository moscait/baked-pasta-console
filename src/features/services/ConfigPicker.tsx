import React, { useMemo } from 'react';
import type { Config, ConfigType, Service } from '../../services/api-types';
import { ConfigTypeGroup, groupConfigsByType, selectConfigForType, servicesByConfig } from './service-configs';

/** One-line preview of a config's data. */
function dataSummary(data: Record<string, unknown>): string {
  const text = JSON.stringify(data);
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

/**
 * Chooses the configs attached to a service: one radio group per config type, so at most one
 * config per type can be picked (the controller's rule). Each option shows what the config
 * contains and which other services use it. Config types the console does not recognise as
 * service configuration are listed under a collapsed "Other config types" section.
 */
export const ConfigPicker: React.FC<{
  configs: Config[];
  configTypes: ConfigType[];
  services: Service[];
  /** The service being edited, so it is not listed among a config's other users. */
  serviceId?: string;
  selected: string[];
  onChange: (next: string[]) => void;
}> = ({ configs, configTypes, services, serviceId, selected, onChange }) => {
  const groups = useMemo(() => groupConfigsByType(configs, configTypes), [configs, configTypes]);
  const usedBy = useMemo(() => servicesByConfig(services), [services]);
  const known = groups.filter((g) => g.known);
  const other = groups.filter((g) => !g.known);
  const otherSelected = other.some((g) => g.configs.some((c) => selected.includes(c.id)));
  const missing = selected.filter((id) => !configs.some((c) => c.id === id));

  const renderGroup = (g: ConfigTypeGroup) => {
    const current = g.configs.filter((c) => selected.includes(c.id));
    const pick = (id: string | null) => onChange(selectConfigForType(selected, g.typeId, id, configs));
    const radioName = `cfg-type-${g.typeId}`;
    return (
      <fieldset key={g.typeId} className="rounded-lg border border-[var(--ac-line)] p-2 space-y-1 min-w-0">
        <legend className="px-1">
          <span className="font-mono font-semibold">{g.typeName}</span>
          {g.purpose && <span className="text-[var(--ac-muted)]"> · {g.purpose}</span>}
        </legend>
        {current.length > 1 && (
          <p className="m-0 text-[var(--ac-pending)]">
            {current.length} configs of this type are attached; a service can use only one. Choose one to keep.
          </p>
        )}
        <label className="flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer hover:bg-[var(--ac-surface-2)]">
          <input type="radio" name={radioName} checked={current.length === 0} onChange={() => pick(null)} />
          <span className="text-[var(--ac-muted)]">None</span>
        </label>
        {g.configs.map((c) => {
          const on = selected.includes(c.id);
          const others = (usedBy.get(c.id) || []).filter((s) => s.id !== serviceId);
          return (
            <label
              key={c.id}
              className={`flex items-start gap-2 px-2 py-1.5 rounded-md border cursor-pointer ${
                on
                  ? 'border-[var(--ac-dial)] bg-[var(--ac-dial-soft)]'
                  : 'border-transparent hover:bg-[var(--ac-surface-2)]'
              }`}
            >
              <input
                type="radio"
                name={radioName}
                className="mt-0.5"
                checked={on && current.length === 1}
                onChange={() => pick(c.id)}
              />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={`font-mono ${on ? 'font-semibold' : ''}`}>{c.name}</span>
                  {on && (
                    <span className="px-1.5 rounded bg-[var(--ac-dial)] text-white text-[10px] font-semibold">
                      ATTACHED
                    </span>
                  )}
                </span>
                <code className="block truncate text-[11px] text-[var(--ac-muted)]">{dataSummary(c.data)}</code>
                <span className="block text-[11px] text-[var(--ac-muted)]">
                  {others.length
                    ? `Also used by ${others.map((s) => s.name).join(', ')}`
                    : 'Not used by any other service'}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    );
  };

  return (
    <div className="space-y-2 max-h-72 overflow-y-auto p-1">
      {!configs.length && (
        <p className="m-0 text-[var(--ac-muted)]">No configs exist yet. Create them on the Configs tab.</p>
      )}
      {known.map(renderGroup)}
      {other.length > 0 && (
        <details open={otherSelected} className="rounded-lg border border-dashed border-[var(--ac-line)] p-2">
          <summary className="cursor-pointer text-[var(--ac-muted)]">
            Other config types ({other.map((g) => g.typeName).join(', ')}): not standard service configuration
          </summary>
          <div className="space-y-2 pt-2">{other.map(renderGroup)}</div>
        </details>
      )}
      {missing.length > 0 && (
        <div className="rounded-lg border border-[var(--ac-line)] p-2 space-y-1">
          <p className="m-0 text-[var(--ac-pending)]">Attached config ids that no longer exist:</p>
          {missing.map((id) => (
            <div key={id} className="flex items-center justify-between gap-2">
              <code className="text-[11px]">{id}</code>
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-[var(--ac-line)] cursor-pointer"
                onClick={() => onChange(selected.filter((x) => x !== id))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
