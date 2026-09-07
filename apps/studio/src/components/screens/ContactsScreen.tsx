import { Camera, Mail, Pencil, Phone, Plus, Search, Trash2, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { formatContactPhoneNumber, type Contact, type ContactGender } from "../../domain/workspaces";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Select, Textarea } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";

type ContactForm = { mode: "create" } | { mode: "edit"; contactId: string };

const genderLabels: Record<ContactGender, string> = {
  female: "Female",
  male: "Male",
  "": "—",
};

const commonEmailDomains = ["naver.com", "gmail.com", "daum.net", "hanmail.net", "kakao.com"];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

function splitEmail(email: string) {
  const separator = email.indexOf("@");
  return separator < 0
    ? { local: email, domain: "" }
    : { local: email.slice(0, separator), domain: email.slice(separator + 1) };
}

function resizeProfilePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose an image file."));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("Profile photos must be 5 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not load this image."));
      image.onload = () => {
        const maxSize = 512;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Could not process this image."));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.84));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function Avatar({
  contact,
  size = "small",
}: {
  contact: Pick<Contact, "name" | "photoDataUrl">;
  size?: "small" | "large";
}) {
  const dimension = size === "large" ? 150 : 32;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-[var(--border)] bg-[var(--blue-soft)] font-extrabold leading-none text-[var(--blue)]",
        size === "large" ? "text-xl shadow-sm ring-4 ring-[var(--surface)]" : "text-[10px]",
      )}
      style={{
        width: dimension,
        minWidth: dimension,
        maxWidth: dimension,
        height: dimension,
        minHeight: dimension,
        maxHeight: dimension,
        borderRadius: "50%",
      }}
    >
      {contact.photoDataUrl ? (
        <img
          src={contact.photoDataUrl}
          alt=""
          className="absolute inset-0 block h-full w-full object-cover"
          style={{ borderRadius: "50%" }}
        />
      ) : (
        initials(contact.name)
      )}
    </span>
  );
}

export function ContactsScreen({
  contacts,
  onSave,
  onDelete,
}: {
  contacts: Contact[];
  onSave: (contact: Contact) => void;
  onDelete: (contactId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(contacts[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ContactForm | null>(null);
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<ContactGender>("");
  const [emailLocal, setEmailLocal] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return contacts;
    return contacts.filter((contact) =>
      `${contact.name} ${contact.phoneNumber} ${contact.age ?? ""} ${contact.email} ${contact.details} ${genderLabels[contact.gender]}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [contacts, query]);
  const selected = contacts.find((contact) => contact.id === selectedId) ?? contacts[0] ?? null;
  const pendingDelete = contacts.find((contact) => contact.id === pendingDeleteId) ?? null;
  const parsedAge = age.trim() === "" ? null : Number(age);
  const emailEmpty = !emailLocal.trim() && !emailDomain.trim();
  const emailValid =
    emailEmpty || (/^[^\s@]+$/.test(emailLocal.trim()) && /^[^\s@]+\.[^\s@]+$/.test(emailDomain.trim()));
  const ageValid = parsedAge === null || (Number.isInteger(parsedAge) && parsedAge >= 0 && parsedAge <= 120);
  const canSubmit = Boolean(name.trim() && phoneNumber.trim() && ageValid && emailValid);

  const resetForm = () => {
    setName("");
    setPhoneNumber("");
    setAge("");
    setGender("");
    setEmailLocal("");
    setEmailDomain("");
    setPhotoDataUrl("");
    setPhotoError(null);
    setDetails("");
  };

  const openCreate = () => {
    resetForm();
    setForm({ mode: "create" });
  };

  const openEdit = (contact: Contact) => {
    const email = splitEmail(contact.email);
    setSelectedId(contact.id);
    setName(contact.name);
    setPhoneNumber(formatContactPhoneNumber(contact.phoneNumber));
    setAge(contact.age === null ? "" : String(contact.age));
    setGender(contact.gender);
    setEmailLocal(email.local);
    setEmailDomain(email.domain);
    setPhotoDataUrl(contact.photoDataUrl);
    setPhotoError(null);
    setDetails(contact.details);
    setForm({ mode: "edit", contactId: contact.id });
  };

  const submit = () => {
    if (!form || !canSubmit) return;
    const now = new Date().toISOString();
    const existing = form.mode === "edit" ? contacts.find((contact) => contact.id === form.contactId) : null;
    const contact: Contact = {
      id: existing?.id ?? `contact-${crypto.randomUUID()}`,
      name: name.trim(),
      phoneNumber: formatContactPhoneNumber(phoneNumber),
      age: parsedAge,
      gender,
      email: emailEmpty ? "" : `${emailLocal.trim()}@${emailDomain.trim().toLocaleLowerCase()}`,
      photoDataUrl,
      details: details.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(contact);
    setSelectedId(contact.id);
    setForm(null);
  };

  const updatePhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    try {
      setPhotoDataUrl(await resizeProfilePhoto(file));
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : "Could not process this image.");
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const remaining = contacts.filter((contact) => contact.id !== pendingDelete.id);
    onDelete(pendingDelete.id);
    if (selected?.id === pendingDelete.id) setSelectedId(remaining[0]?.id ?? "");
    setPendingDeleteId(null);
  };

  return (
    <main id="main-content" className="flex min-h-0 flex-1 flex-col bg-[var(--app-bg)]">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4 max-sm:px-4">
        <div className="relative w-80 max-sm:min-w-0 max-sm:flex-1">
          <Search
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, phone number, or email"
            className="pl-9 text-xs"
            aria-label="Search contacts"
          />
        </div>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Add Contact
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto p-5" aria-label="Contact list">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold text-[var(--text)]">
              All Contacts <span className="text-[var(--text-muted)]">{contacts.length}</span>
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">Workspace directory</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            {contacts.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <UserRound className="mx-auto h-7 w-7 text-[var(--text-muted)]" />
                <p className="mt-4 text-sm font-bold text-[var(--text)]">No contacts</p>
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  Add a contact to keep recipient information in this workspace.
                </p>
                <Button variant="primary" size="sm" className="mt-5" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" /> Add Contact
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <Search className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
                <p className="mt-4 text-sm font-bold text-[var(--text)]">No matching contacts</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-3 py-3">Phone Number</th>
                      <th className="px-3 py-3">Age</th>
                      <th className="px-3 py-3">Gender</th>
                      <th className="px-3 py-3">Email</th>
                      <th className="px-3 py-3">Updated</th>
                      <th className="w-24" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filtered.map((contact) => (
                      <tr
                        key={contact.id}
                        onClick={() => setSelectedId(contact.id)}
                        className={cn(
                          "cursor-pointer outline-none transition-colors hover:bg-[var(--surface-hover)]",
                          selected?.id === contact.id && "bg-[var(--blue-soft)]",
                        )}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setSelectedId(contact.id);
                        }}
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <Avatar contact={contact} />
                            <p className="text-[11px] font-bold text-[var(--text)]">{contact.name}</p>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {formatContactPhoneNumber(contact.phoneNumber)}
                        </td>
                        <td className="px-3 py-3.5 text-[10px] text-[var(--text-secondary)]">{contact.age ?? "—"}</td>
                        <td className="px-3 py-3.5 text-[10px] text-[var(--text-secondary)]">
                          {genderLabels[contact.gender]}
                        </td>
                        <td className="px-3 py-3.5 text-[10px] text-[var(--text-secondary)]">{contact.email || "—"}</td>
                        <td className="px-3 py-3.5 text-[10px] text-[var(--text-secondary)]">
                          {formatDate(contact.updatedAt)}
                        </td>
                        <td className="pr-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <Tooltip content="Edit contact">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Edit ${contact.name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEdit(contact);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="Delete contact">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-[var(--text-muted)] hover:bg-[var(--red-soft)] hover:text-[var(--red)]"
                                aria-label={`Delete ${contact.name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPendingDeleteId(contact.id);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        {selected && <ContactDetail contact={selected} onEdit={() => openEdit(selected)} />}
      </div>

      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
        title={form?.mode === "edit" ? "Edit Contact" : "Add Contact"}
        size="large"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSubmit} onClick={submit}>
              {form?.mode === "edit" ? "Save Changes" : "Add Contact"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-col items-center">
            <label
              className="group relative cursor-pointer rounded-full outline-none focus-within:ring-2 focus-within:ring-[var(--ring)]"
              aria-label="Upload profile photo"
            >
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => void updatePhoto(event.target.files?.[0])}
              />
              <Avatar contact={{ name, photoDataUrl }} size="large" />
              <span className="absolute bottom-0 right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--primary)] text-white shadow-md transition-transform group-hover:scale-105">
                <Camera className="h-3.5 w-3.5" />
              </span>
            </label>
            {photoDataUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-[var(--text-muted)]"
                onClick={() => setPhotoDataUrl("")}
              >
                Remove photo
              </Button>
            )}
            {photoError && (
              <p role="alert" className="mt-2 text-[10px] font-semibold text-[var(--red)]">
                {photoError}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-5 max-sm:grid-cols-1">
            <Field label="Name" htmlFor="contact-name">
              <Input
                id="contact-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Kim Younghee"
                autoFocus
              />
            </Field>
            <Field label="Phone Number" htmlFor="contact-phone">
              <Input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(formatContactPhoneNumber(event.target.value))}
                placeholder="010-1234-5678"
              />
            </Field>
            <Field label="Age" htmlFor="contact-age" error={!ageValid ? "Enter an age between 0 and 120." : undefined}>
              <Input
                id="contact-age"
                type="number"
                min={0}
                max={120}
                value={age}
                onChange={(event) => setAge(event.target.value)}
                placeholder="e.g. 72"
                aria-invalid={!ageValid}
              />
            </Field>
            <Field label="Gender" htmlFor="contact-gender">
              <Select
                id="contact-gender"
                value={gender}
                onChange={(event) => setGender(event.target.value as ContactGender)}
              >
                <option value="">Select gender</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Email"
            htmlFor="contact-email-local"
            error={!emailValid ? "Enter a valid email address." : undefined}
          >
            <div
              className={cn(
                "flex h-10 w-full items-center overflow-hidden rounded-lg border bg-[var(--surface)] transition-shadow focus-within:border-[var(--blue)] focus-within:ring-2 focus-within:ring-[var(--blue-soft)]",
                emailValid
                  ? "border-[var(--border-strong)]"
                  : "border-[var(--red)] focus-within:border-[var(--red)] focus-within:ring-[var(--red-soft)]",
              )}
            >
              <input
                id="contact-email-local"
                value={emailLocal}
                onChange={(event) => setEmailLocal(event.target.value)}
                placeholder="name"
                aria-invalid={!emailValid}
                className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <span className="shrink-0 text-sm font-semibold text-[var(--text-muted)]">@</span>
              <input
                value={emailDomain}
                onChange={(event) => setEmailDomain(event.target.value)}
                placeholder="domain.com"
                aria-label="Email domain"
                aria-invalid={!emailValid}
                className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <select
                value={commonEmailDomains.includes(emailDomain) ? emailDomain : ""}
                onChange={(event) => {
                  if (event.target.value) setEmailDomain(event.target.value);
                }}
                aria-label="Select a common email domain"
                className="h-full w-40 shrink-0 cursor-pointer border-0 border-l border-solid border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm text-[var(--text-secondary)] outline-none"
              >
                <option value="">Common domains</option>
                {commonEmailDomains.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Details" htmlFor="contact-details">
            <Textarea
              id="contact-details"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Add relevant notes about this contact."
              className="min-h-24"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete this contact?"
        description={
          pendingDelete ? `“${pendingDelete.name}” will be permanently removed from this workspace.` : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              <Trash2 className="h-4 w-4" /> Delete Contact
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          This action cannot be undone.
        </div>
      </Dialog>
    </main>
  );
}

function ContactDetail({ contact, onEdit }: { contact: Contact; onEdit: () => void }) {
  return (
    <aside
      className="w-[372px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] max-xl:hidden"
      aria-label="Selected contact profile"
    >
      <div className="relative w-full border-b border-[var(--border)]" style={{ height: 270, minHeight: 270 }}>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${contact.name}`}
          className="absolute right-5 top-5 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-xs outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="absolute inset-0 flex items-center justify-center px-8 py-12">
          <div className="flex flex-col items-center gap-4">
            <Avatar contact={contact} size="large" />
            <h2 className="text-center text-sm font-medium tracking-[-0.01em] text-[var(--text-secondary)]">
              {contact.name}
            </h2>
          </div>
        </div>
      </div>
      <div className="px-6 pb-5 pt-2">
        <div className="divide-y divide-[var(--border)]">
          <div className="grid grid-cols-2 gap-x-5 py-3">
            <ProfileField label="Age" value={contact.age === null ? "—" : `${contact.age}`} />
            <ProfileField label="Gender" value={genderLabels[contact.gender]} />
          </div>
          <div className="grid grid-cols-2 gap-x-5 py-3">
            <ProfileField
              label="Phone Number"
              icon={<Phone className="h-3.5 w-3.5" />}
              value={formatContactPhoneNumber(contact.phoneNumber)}
              mono
            />
            <ProfileField label="Email" icon={<Mail className="h-3.5 w-3.5" />} value={contact.email || "—"} />
          </div>
          <div className="py-4">
            <ProfileField label="Details" value={contact.details || "No details added."} multiline />
          </div>
        </div>
      </div>
    </aside>
  );
}

function ProfileField({
  label,
  value,
  icon,
  mono,
  multiline,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <section className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <div
        className={cn(
          "mt-1.5 flex min-w-0 items-start gap-1.5 text-[11px] text-[var(--text)]",
          mono && "font-mono",
          multiline && "whitespace-pre-wrap leading-5 text-[var(--text-secondary)]",
        )}
      >
        {icon && <span className="mt-px shrink-0 text-[var(--blue)]">{icon}</span>}
        <span
          className={cn("min-w-0", multiline ? "break-words" : "truncate whitespace-nowrap")}
          title={!multiline ? value : undefined}
        >
          {value}
        </span>
      </div>
    </section>
  );
}
