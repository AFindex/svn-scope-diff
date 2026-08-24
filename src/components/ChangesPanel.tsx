import { useMemo, useState } from "react";
import { displayStatusCode } from "../status";
import type { ChangeEntry } from "../types";
import { ChangeList, type ChangeListSortKey, type SortDirection } from "./ChangeList";
import { ChangeTree } from "./ChangeTree";
import { Icon } from "./Icons";

interface ChangesPanelProps {
  changes: ChangeEntry[];
  selectedPath?: string;
  onSelect: (change: ChangeEntry) => void;
}

function statusCounts(changes: ChangeEntry[]) {
  return changes.reduce<Record<string, number>>((counts, change) => {
    counts[change.statusCode] = (counts[change.statusCode] ?? 0) + 1;
    return counts;
  }, {});
}

export function ChangesPanel({ changes, selectedPath, onSelect }: ChangesPanelProps) {
  const [query, setQuery] = useState("");
  const [changeView, setChangeView] = useState<"tree" | "list">("tree");
  const [listSortKey, setListSortKey] = useState<ChangeListSortKey>("path");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const counts = useMemo(() => statusCounts(changes), [changes]);

  return (
    <div className="changes-panel">
      <div className="changes-toolbar">
        <div className="changes-heading">
          <div>
            <strong>本地修改</strong>
            <span>{changes.length}</span>
          </div>
          <div className="status-summary" aria-label="状态统计">
            {Object.entries(counts).map(([code, count]) => (
              <span key={code}>
                <b className="status-text" data-status={code}>{displayStatusCode(code)}</b>{count}
              </span>
            ))}
          </div>
        </div>

        <div className="sidebar-view-toolbar">
          <div className="change-view-switch" role="group" aria-label="修改显示模式">
            <button
              type="button"
              className={changeView === "tree" ? "active" : ""}
              aria-pressed={changeView === "tree"}
              title="按目录层级显示"
              onClick={() => setChangeView("tree")}
            >
              <Icon name="tree" size={14} />
              层级
            </button>
            <button
              type="button"
              className={changeView === "list" ? "active" : ""}
              aria-pressed={changeView === "list"}
              title="以可排序的平铺列表显示"
              onClick={() => setChangeView("list")}
            >
              <Icon name="list" size={14} />
              列表
            </button>
          </div>

          {changeView === "list" && (
            <div className="list-sort-toolbar">
              <label className="sort-select" title="列表排序字段">
                <span className="visually-hidden">排序字段</span>
                <select
                  value={listSortKey}
                  aria-label="排序字段"
                  onChange={(event) => setListSortKey(event.target.value as ChangeListSortKey)}
                >
                  <option value="path">相对路径</option>
                  <option value="name">文件名</option>
                  <option value="directory">所在目录</option>
                  <option value="status">修改状态</option>
                  <option value="extension">扩展名</option>
                </select>
              </label>
              <button
                type="button"
                className="sort-direction-button"
                title={sortDirection === "asc" ? "当前升序，点击切换为降序" : "当前降序，点击切换为升序"}
                aria-label={sortDirection === "asc" ? "升序排列" : "降序排列"}
                onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")}
              >
                <Icon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      <label className="search-box">
        <Icon name="search" size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选文件" />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="清除筛选">
            <Icon name="close" size={13} />
          </button>
        )}
      </label>

      <div className="changes-scroll">
        {changes.length ? (
          changeView === "tree" ? (
            <ChangeTree
              changes={changes}
              selectedPath={selectedPath}
              query={query}
              onSelect={onSelect}
            />
          ) : (
            <ChangeList
              changes={changes}
              selectedPath={selectedPath}
              query={query}
              sortKey={listSortKey}
              direction={sortDirection}
              onSelect={onSelect}
            />
          )
        ) : (
          <div className="clean-state">
            <Icon name="empty" size={30} />
            <strong>工作区干净</strong>
            <span>此目录及子目录没有本地修改</span>
          </div>
        )}
      </div>
    </div>
  );
}
