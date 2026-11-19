import { useState, type FormEvent } from "react";

interface SearchFieldProps {
  label: string;
  placeholder: string;
  initial?: string;
  /** 빈 문자열이면 검색을 지운 것 */
  onSearch: (value: string) => void;
  /** 칸 아래 안내(규칙). 오류가 있으면 오류가 대신 보인다 */
  help?: string;
  error?: string;
  /** 제출 전 검사 — 오류 글을 돌려주면 보내지 않는다 */
  validate?: (value: string) => string | null;
}

/** 돋보기가 든 검색칸. 엔터 · 단추로 찾고, 값이 있으면 「지우기」가 생긴다. */
export default function SearchField({
  label,
  placeholder,
  initial = "",
  onSearch,
  help,
  error,
  validate,
}: SearchFieldProps) {
  const [value, setValue] = useState(initial);
  const [localError, setLocalError] = useState("");
  const shown = error || localError;
  const id = `adm-search-${label.replace(/\s+/g, "-")}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    const problem = validate?.(trimmed) ?? null;
    setLocalError(problem ?? "");
    if (problem) return;
    onSearch(trimmed);
  };

  const clear = () => {
    setValue("");
    setLocalError("");
    onSearch("");
  };

  return (
    <div className="adm-searchfield">
      <form className="adm-search-form" role="search" onSubmit={submit}>
        <label className="adm-search adm-search--icon">
          <span className="adm-sr-only">{label}</span>
          <MagnifierIcon />
          <input
            className="adm-input adm-input--search"
            type="search"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            aria-describedby={`${id}-help`}
            aria-invalid={shown ? true : undefined}
          />
        </label>
        <button type="submit" className="adm-button adm-button--primary">
          검색
        </button>
        {(initial || value) && (
          <button type="button" className="adm-button adm-button--ghost" onClick={clear}>
            지우기
          </button>
        )}
      </form>
      {(help || shown) && (
        <p
          id={`${id}-help`}
          className={shown ? "adm-field__error" : "adm-search-help"}
          role={shown ? "alert" : undefined}
        >
          {shown || help}
        </p>
      )}
    </div>
  );
}

function MagnifierIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="adm-search__icon">
      <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
