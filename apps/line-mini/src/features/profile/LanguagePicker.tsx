import { Button, Space } from "antd-mobile";

import { useT, type MessageKey } from "../../i18n";
import { LANGS, useLanguage } from "../../stores/language";

/** Language switch (FR-SYS-004): takes effect at once and is remembered on this device. */
export function LanguagePicker() {
  const t = useT();
  const { lang, setLang } = useLanguage();
  return (
    <div>
      <div className="section__label">{t("my.language")}</div>
      <Space wrap>
        {LANGS.map((l) => (
          <Button
            key={l}
            size="small"
            color={l === lang ? "primary" : "default"}
            aria-pressed={l === lang}
            onClick={() => setLang(l)}
          >
            {t(`lang.${l}` as MessageKey)}
          </Button>
        ))}
      </Space>
    </div>
  );
}
