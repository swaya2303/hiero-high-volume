import React from 'react';
import type { EntityCreationResult } from '../types.js';

export interface JobStatusTableProps {
  /** Array of results emitted by the batch job's `results` array. */
  results: EntityCreationResult[];
  /** Maximum number of results to display. Defaults to 50. */
  maxRows?: number;
  /** Whether to show the fee column. Defaults to false. */
  showFees?: boolean;
}

const CONTAINER_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-family-base, inherit)',
  color: 'var(--color-text, inherit)',
  width: '100%',
  overflowX: 'auto',
  border: '1px solid var(--color-border, #e2e8f0)',
  borderRadius: 'var(--border-radius-base, 8px)',
  backgroundColor: 'var(--color-bg, transparent)',
};

const TABLE_STYLE: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
  fontSize: 'var(--font-size-sm, 13px)',
};

const TH_STYLE: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--color-border, #e2e8f0)',
  backgroundColor: 'var(--color-bg-muted, #f8fafc)',
  fontWeight: 'var(--font-weight-medium, 500)',
  color: 'var(--color-text-muted, #666)',
};

const TD_STYLE: React.CSSProperties = {
  padding: '10px 16px',
  borderBottom: '1px solid var(--color-border, #e2e8f0)',
};

const SUCCESS_STATUS_STYLE: React.CSSProperties = {
  color: 'var(--color-success, #16a34a)',
  fontWeight: 'bold',
};

const ERROR_STATUS_STYLE: React.CSSProperties = {
  color: 'var(--color-error, #ef4444)',
  fontWeight: 'bold',
};

const ERROR_TEXT_STYLE: React.CSSProperties = {
  color: 'var(--color-error, #ef4444)',
};

const EMPTY_STYLE: React.CSSProperties = {
  padding: '32px 16px',
  textAlign: 'center',
  color: 'var(--color-text-muted, #666)',
  fontStyle: 'italic',
};

const FOOTER_STYLE: React.CSSProperties = {
  padding: '12px 16px',
  backgroundColor: 'var(--color-bg-muted, #f8fafc)',
  color: 'var(--color-text-muted, #666)',
  fontSize: 'var(--font-size-xs, 12px)',
  textAlign: 'right',
  borderTop: '1px solid var(--color-border, #e2e8f0)',
};

function truncateTxId(txId: string | undefined): string {
  if (!txId) return '-';
  return txId.length > 20 ? `${txId.slice(0, 20)}...` : txId;
}

export function JobStatusTable({
  results,
  maxRows = 50,
  showFees = false,
}: JobStatusTableProps): React.ReactElement | null {
  const displayResults = results.slice(-maxRows).reverse();

  return (
    <div style={CONTAINER_STYLE}>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <th style={TH_STYLE}>Status</th>
            <th style={TH_STYLE}>Entity ID</th>
            <th style={TH_STYLE}>Transaction ID</th>
            {showFees && <th style={TH_STYLE}>Fee (HBAR)</th>}
            <th style={TH_STYLE}>Error</th>
          </tr>
        </thead>
        <tbody>
          {results.length === 0 ? (
            <tr>
              <td
                colSpan={showFees ? 5 : 4}
                style={EMPTY_STYLE}
              >
                No results yet
              </td>
            </tr>
          ) : (
            displayResults.map((result, i) => (
              // Use txId as key if available, fallback to index
              <tr key={result.transactionId ?? i}>
                <td style={TD_STYLE}>
                  {result.success ? (
                    <span style={SUCCESS_STATUS_STYLE}>OK</span>
                  ) : (
                    <span style={ERROR_STATUS_STYLE}>FAIL</span>
                  )}
                </td>
                <td style={TD_STYLE}>{result.entityId ?? '-'}</td>
                <td style={TD_STYLE}>{truncateTxId(result.transactionId)}</td>
                {showFees && (
                  <td style={TD_STYLE}>
                    {result.feeChargedHbar?.toFixed(4) ?? '-'}
                  </td>
                )}
                <td style={{ ...TD_STYLE, ...ERROR_TEXT_STYLE }}>
                  {result.error ?? '-'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {results.length > maxRows && (
        <div style={FOOTER_STYLE}>
          Showing last {String(displayResults.length)} of {String(results.length)}{' '}
          results
        </div>
      )}
    </div>
  );
}
