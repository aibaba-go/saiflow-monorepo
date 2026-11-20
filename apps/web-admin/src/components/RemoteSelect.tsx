import { useQuery } from "@tanstack/react-query";
import { Select, Spin } from "antd";
import { useEffect, useState } from "react";

/** The value once it has stopped changing for `ms` milliseconds. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export interface Labeled {
  value: number;
  label: string;
}

interface Common<O> {
  id?: string;
  placeholder?: string;
  /** Query key prefix for this search; the debounced text is appended. */
  queryKey: readonly unknown[];
  search: (q: string) => Promise<{ items: O[] }>;
  toOption: (item: O) => Labeled;
}

/** Searches as the admin types (debounced; the server returns at most 20) and keeps
 * the labels of what is chosen. Nothing is searched for an empty text. */
function useRemote<O>({ queryKey, search, toOption }: Common<O>) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const result = useQuery({
    queryKey: [...queryKey, q],
    queryFn: () => search(q),
    enabled: q.length > 0,
  });
  const items = result.data?.items ?? [];
  return {
    items,
    options: items.map(toOption),
    onSearch: setText,
    notFound: result.isFetching ? <Spin size="small" /> : null,
  };
}

export function RemoteMultiSelect<O>({
  value,
  onChange,
  ...common
}: Common<O> & { value: Labeled[]; onChange: (next: Labeled[]) => void }) {
  const remote = useRemote(common);
  return (
    <Select
      id={common.id}
      mode="multiple"
      labelInValue
      showSearch
      filterOption={false}
      allowClear
      style={{ width: "100%" }}
      placeholder={common.placeholder}
      value={value}
      onSearch={remote.onSearch}
      onChange={(next: Labeled[]) => onChange(next.map((v) => ({ value: v.value, label: String(v.label) })))}
      options={remote.options}
      notFoundContent={remote.notFound}
    />
  );
}

export function RemoteSingleSelect<O>({
  value,
  onChange,
  ...common
}: Common<O> & { value: O | null; onChange: (next: O | null) => void }) {
  const remote = useRemote(common);
  const current = value ? common.toOption(value) : undefined;
  return (
    <Select
      id={common.id}
      labelInValue
      showSearch
      filterOption={false}
      allowClear
      style={{ width: "100%" }}
      placeholder={common.placeholder}
      value={current}
      onSearch={remote.onSearch}
      onChange={(next?: Labeled) => {
        if (!next) return onChange(null);
        onChange(remote.items.find((item) => common.toOption(item).value === next.value) ?? null);
      }}
      options={remote.options}
      notFoundContent={remote.notFound}
    />
  );
}
