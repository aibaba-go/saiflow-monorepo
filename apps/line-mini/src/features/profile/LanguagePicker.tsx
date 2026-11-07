
import { useT, type MessageKey } from "../../i18n";
import { LANGS, useLanguage } from "../../stores/language";
import { Button } from "../../components/ui/button";

/** Language switch (FR-SYS-004): takes effect at once and is remembered on this device. */
export function LanguagePicker() {
  const t = useT();
  const { lang, setLang } = useLanguage();
  return (
    <div>
      <div className="section__label">{t("my.language")}</div>
      <div className="flex flex-wrap gap-2">
        {LANGS.map((l) => (
          <Button
            key={l}
            size="sm"
            variant={l === lang ? "primary" : "outline"}
            aria-pressed={l === lang}
            onClick={() => setLang(l)}
          >
            {t(`lang.${l}` as MessageKey)}
          </Button>
        ))}
      </div>
    </div>
  );
}
