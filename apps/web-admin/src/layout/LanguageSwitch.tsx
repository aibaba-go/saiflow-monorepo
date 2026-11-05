import { Select } from "antd";

import { useT } from "../i18n";
import { LANGS, useLanguage, type Lang } from "../stores/language";

/** zh / en switch (FR-SYS-062-01). */
export function LanguageSwitch() {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const setLang = useLanguage((s) => s.setLang);
  return (
    <Select<Lang>
      size="small"
      value={lang}
      onChange={setLang}
      style={{ width: 100 }}
      options={LANGS.map((l) => ({ value: l, label: t(`lang.${l}`) }))}
    />
  );
}
