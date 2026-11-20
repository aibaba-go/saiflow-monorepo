
import { useT, type MessageKey } from "../../i18n";
import { LANGS, useLanguage } from "../../stores/language";
import { Button } from "../../components/ui/button";

/** The three language buttons; the chosen one is pressed (FR-SYS-004). */
export function LanguageButtons({ className = "flex flex-wrap gap-2" }: { className?: string }) {
  const t = useT();
  const { lang, setLang } = useLanguage();
  return (
    <div className={className} role="group" aria-label={t("my.language")}>
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
  );
}

/** Language switch (FR-SYS-004): takes effect at once and is remembered on this device. */
export function LanguagePicker() {
  const t = useT();
  return (
    <div>
      <div className="section__label">{t("my.language")}</div>
      <LanguageButtons />
    </div>
  );
}
