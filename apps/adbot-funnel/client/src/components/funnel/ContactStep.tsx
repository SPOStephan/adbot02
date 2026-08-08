import { useEffect, useRef, type ChangeEvent, type FormEvent } from "react";
import type { ApplicationContact, ContactPage } from "@shared/funnel";
import { ArrowLeft, Check, FileText, Loader2, UploadCloud, X } from "lucide-react";

export type ResumeDraft = { file: File; dataBase64: string };

type ContactStepProps = {
  page: ContactPage;
  contact: ApplicationContact;
  consent: boolean;
  resume?: ResumeDraft;
  error?: string;
  pending: boolean;
  onContactChange: (key: keyof ApplicationContact, value: string) => void;
  onConsentChange: (value: boolean) => void;
  onResumeChange: (resume?: ResumeDraft) => void;
  onFileError: (message: string) => void;
  onBack: () => void;
  onSubmit: () => void;
};

export function ContactStep({ page, contact, consent, resume, error, pending, onContactChange, onConsentChange, onResumeChange, onFileError, onBack, onSubmit }: ContactStepProps) {
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const selectResume = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    if (!allowedTypes.has(file.type)) {
      onFileError("Bitte lade deinen Lebenslauf als PDF-, DOC- oder DOCX-Datei hoch.");
      event.target.value = "";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      onFileError("Die Datei ist größer als 8 MB. Bitte wähle eine kleinere Datei.");
      event.target.value = "";
      return;
    }
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      onFileError("");
      onResumeChange({ file, dataBase64 });
    } catch {
      event.target.value = "";
      onFileError("Die Datei konnte nicht gelesen werden. Bitte wähle sie erneut aus.");
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };

  return (
    <section className="funnel-step funnel-contact-step" aria-labelledby={`${page.id}-title`}>
      <div className="funnel-question-copy">
        {page.eyebrow && <p className="funnel-eyebrow">{page.eyebrow}</p>}
        <h1 id={`${page.id}-title`} tabIndex={-1}>{page.title}</h1>
        <p className="funnel-description">{page.description}</p>
      </div>
      <form className="funnel-contact-form" onSubmit={submit} aria-busy={pending} aria-describedby={error ? `${page.id}-error` : undefined}>
        <div className="funnel-field-grid">
          {page.fields.filter(field => field.enabled).map(field => {
            const fieldId = `${page.id}-${field.key}`;
            const isInvalid = Boolean(error && field.required && !contact[field.key]?.trim());
            return <div className={field.inputType === "textarea" ? "funnel-field funnel-field-wide" : "funnel-field"} key={field.key}>
              <label htmlFor={fieldId}>{field.label}{field.required && <em>*</em>}</label>
              {field.inputType === "textarea" ? (
                <textarea id={fieldId} value={contact[field.key] ?? ""} placeholder={field.placeholder} required={field.required} aria-invalid={isInvalid} rows={4} onChange={event => onContactChange(field.key, event.target.value)} />
              ) : (
                <input id={fieldId} type={field.inputType} value={contact[field.key] ?? ""} placeholder={field.placeholder} required={field.required} aria-invalid={isInvalid} autoComplete={field.key === "name" ? "name" : field.key === "email" ? "email" : field.key === "phone" ? "tel" : field.key === "company" ? "organization" : "off"} onChange={event => onContactChange(field.key, event.target.value)} />
              )}
            </div>;
          })}
        </div>
        {page.resumeEnabled && (
          <div className="funnel-upload-wrap">
            <span className="funnel-field-label">{page.resumeLabel}{page.resumeRequired && <em>*</em>}</span>
            {resume ? (
              <div className="funnel-uploaded-file" aria-live="polite"><FileText size={22} aria-hidden="true" /><span><strong>{resume.file.name}</strong><small>{(resume.file.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" aria-label="Lebenslauf entfernen" onClick={() => onResumeChange(undefined)}><X size={18} /></button></div>
            ) : (
              <label className="funnel-upload-zone" htmlFor={`${page.id}-resume`}><UploadCloud size={26} aria-hidden="true" /><strong>Datei auswählen</strong><span id={`${page.id}-resume-hint`}>PDF, DOC oder DOCX · maximal 8 MB</span><input id={`${page.id}-resume`} type="file" required={page.resumeRequired} aria-describedby={`${page.id}-resume-hint`} accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={selectResume} /></label>
            )}
          </div>
        )}
        <div className="funnel-consent"><input id={`${page.id}-consent`} type="checkbox" checked={consent} required={page.consentRequired} onChange={event => onConsentChange(event.target.checked)} /><label htmlFor={`${page.id}-consent`}>{page.consentLabel}{page.consentRequired && " *"}</label></div>
        {error && <div id={`${page.id}-error`} ref={errorRef} className="funnel-form-error" role="alert" tabIndex={-1}>{error}</div>}
        <div className="funnel-step-actions">
          <button className="funnel-secondary-button" type="button" onClick={onBack} disabled={pending}><ArrowLeft size={18} />Zurück</button>
          <button className="funnel-primary-button" type="submit" disabled={pending} aria-busy={pending}>{pending ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}{pending ? "Wird gesendet …" : page.buttonLabel}</button>
        </div>
      </form>
    </section>
  );
}
