import { Select } from "antd";

import { useT } from "../i18n";
import { LANGS, useLanguage, type Lang } from "../stores/language";

/** en / th / zh switch, on every page including login and the register guide (FR-SYS-093). */
export function LanguageSwitch() {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const setLang = useLanguage((s) => s.setLang);
  return (
    <Select<Lang>
      size="small"
      aria-label={t("my.language")}
      value={lang}
      onChange={setLang}
      style={{ width: 110 }}
      options={LANGS.map((l) => ({ value: l, label: t(`lang.${l}`) }))}
    />
  );
}
