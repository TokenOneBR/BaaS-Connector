export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Numeros alinham a direita e usam `tabular-nums`: coluna de dinheiro le-se
   *  em varredura vertical, e fonte proporcional destroi isso. */
  numeric?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  empty,
}: {
  rows: readonly T[];
  columns: ReadonlyArray<Column<T>>;
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded border border-border bg-surface p-6 text-sm text-text-muted">{empty}</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-raised text-left text-xs uppercase text-text-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={`px-3 py-2 font-medium ${column.numeric ? 'text-right' : ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface">
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={`px-3 py-2 ${column.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
