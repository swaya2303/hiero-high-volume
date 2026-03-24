import React, { useState, useCallback } from 'react';
import type { EntityType, CostEstimate } from '../types.js';

export interface CostEstimatorWidgetProps {
  /** Callback triggered to perform the estimation (bind to `creator.estimateCost`). */
  onEstimate: (
    count: number,
    entityType: EntityType,
    useHighVolume: boolean,
  ) => Promise<CostEstimate>;

  /** Default number of entities to populate the input with. Defaults to 1000. */
  defaultCount?: number;

  /** Default entity type to populate the select with. Defaults to 'account'. */
  defaultEntityType?: EntityType;
}

const CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  fontFamily: 'var(--font-family-base, inherit)',
  color: 'var(--color-text, inherit)',
  padding: '16px',
  border: '1px solid var(--color-border, #e2e8f0)',
  borderRadius: 'var(--border-radius-base, 8px)',
  backgroundColor: 'var(--color-bg, transparent)',
};

const FORM_GROUP_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const FORM_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--font-size-sm, 12px)',
  fontWeight: 'var(--font-weight-medium, 500)',
  color: 'var(--color-text-muted, #666)',
};

const INPUT_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid var(--color-border, #ccc)',
  borderRadius: '4px',
  fontFamily: 'inherit',
  fontSize: 'inherit',
};

const CHECKBOX_LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: 'var(--font-size-base, 14px)',
  cursor: 'pointer',
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: 'var(--color-primary, #3b82f6)',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 'var(--font-weight-medium, 500)',
};

const BUTTON_DISABLED_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: 'var(--color-disabled, #9ca3af)',
  cursor: 'not-allowed',
};

const RESULTS_CONTAINER_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
  gap: '16px',
  marginTop: '8px',
  paddingTop: '16px',
  borderTop: '1px solid var(--color-border, #e2e8f0)',
};

const STAT_BOX_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const STAT_VALUE_STYLE: React.CSSProperties = {
  fontSize: 'var(--font-size-lg, 18px)',
  fontWeight: 'bold',
};

const WARNING_BOX_STYLE: React.CSSProperties = {
  marginTop: '12px',
  padding: '12px',
  backgroundColor: 'var(--color-warning-bg, #fffbe6)',
  color: 'var(--color-warning-text, #b45309)',
  border: '1px solid var(--color-warning-border, #fef08a)',
  borderRadius: '4px',
  fontSize: 'var(--font-size-sm, 13px)',
};

const ERROR_TEXT_STYLE: React.CSSProperties = {
  color: 'var(--color-error, #ef4444)',
  fontSize: 'var(--font-size-sm, 13px)',
  marginTop: '8px',
};

export function CostEstimatorWidget({
  onEstimate,
  defaultCount = 1000,
  defaultEntityType = 'account',
}: CostEstimatorWidgetProps): React.ReactElement | null {
  const [count, setCount] = useState<number>(defaultCount);
  const [entityType, setEntityType] = useState<EntityType>(defaultEntityType);
  const [useHighVolume, setUseHighVolume] = useState<boolean>(true);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);

  const handleEstimate = useCallback(() => {
    setIsLoading(true);
    setError(null);

    onEstimate(count, entityType, useHighVolume)
      .then(setEstimate)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to estimate cost: ${message}`);
        setEstimate(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [count, entityType, useHighVolume, onEstimate]);

  return (
    <div style={CONTAINER_STYLE}>
      <div style={FORM_ROW_STYLE}>
        <div style={FORM_GROUP_STYLE}>
          <label style={LABEL_STYLE}>Amount</label>
          <input
            style={INPUT_STYLE}
            type="number"
            min={1}
            max={1_000_000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            disabled={isLoading}
          />
        </div>

        <div style={FORM_GROUP_STYLE}>
          <label style={LABEL_STYLE}>Entity type</label>
          <select
            style={INPUT_STYLE}
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as EntityType)}
            disabled={isLoading}
          >
            <option value="account">Account</option>
            <option value="token">Token</option>
            <option value="topic">Topic</option>
          </select>
        </div>

        <div style={FORM_GROUP_STYLE}>
          <label style={CHECKBOX_LABEL_STYLE}>
            <input
              type="checkbox"
              checked={useHighVolume}
              onChange={(e) => setUseHighVolume(e.target.checked)}
              disabled={isLoading}
            />
            Use HIP-1313 Volume Mode
          </label>
        </div>
      </div>

      <div>
        <button
          style={isLoading ? BUTTON_DISABLED_STYLE : BUTTON_STYLE}
          onClick={handleEstimate}
          disabled={isLoading || count < 1}
        >
          {isLoading ? 'Calculating...' : 'Calculate Estimate'}
        </button>
      </div>

      {error && <div style={ERROR_TEXT_STYLE}>{error}</div>}

      {estimate && (
        <>
          <div style={RESULTS_CONTAINER_STYLE}>
            <div style={STAT_BOX_STYLE}>
              <span style={LABEL_STYLE}>Minimum (HBAR)</span>
              <span style={STAT_VALUE_STYLE}>{estimate.minHbar.toFixed(4)}</span>
            </div>
            <div style={STAT_BOX_STYLE}>
              <span style={LABEL_STYLE}>Expected (HBAR)</span>
              <span style={STAT_VALUE_STYLE}>
                {estimate.expectedHbar.toFixed(4)}
              </span>
            </div>
            <div style={STAT_BOX_STYLE}>
              <span style={LABEL_STYLE}>Maximum (HBAR)</span>
              <span style={STAT_VALUE_STYLE}>{estimate.maxHbar.toFixed(4)}</span>
            </div>
          </div>

          {estimate.warning && (
            <div style={WARNING_BOX_STYLE}>
              <strong>Warning:</strong> {estimate.warning}
            </div>
          )}
        </>
      )}
    </div>
  );
}
