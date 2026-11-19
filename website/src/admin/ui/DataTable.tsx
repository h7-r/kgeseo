import type { ReactNode } from "react";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  align?: "start" | "end" | "center";
  /** 숫자 · ID · 날짜 — 고정폭 글꼴과 같은 폭 숫자 */
  mono?: boolean;
  /** 긴 글을 한 줄로 자르고 마우스를 올리면 전체를 보인다. 보일 글을 돌려준다. */
  truncate?: (row: Row) => string;
  width?: string;
}

interface DataTableProps<Row> {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  emptyText: string;
  /** 좁으면 표만 가로로 밀린다. 반폭 카드 안의 작은 표는 0 으로 둔다. */
  minWidth?: number;
}

/** 관리자 표. 행 높이 48, 숫자는 오른쪽 정렬. 좁으면 표만 가로로 밀린다. */
export default function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  emptyText,
  minWidth = 720,
}: DataTableProps<Row>) {
  const cellClass = (column: Column<Row>, isHeader = false) =>
    ["adm-cell", !isHeader && column.mono && "is-mono", column.align && `is-${column.align}`].filter(Boolean).join(" ");

  return (
    <div className="adm-table-wrap">
      <table className="adm-table" style={{ minWidth }}>
        <caption className="adm-sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cellClass(column, true)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="adm-table__empty">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => {
                  const text = column.truncate?.(row);
                  return (
                    <td key={column.key} className={cellClass(column)}>
                      {text !== undefined ? (
                        <span className="adm-truncate" title={text}>
                          {column.render(row)}
                        </span>
                      ) : (
                        column.render(row)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
