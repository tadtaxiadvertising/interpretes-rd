import { z } from "zod";

const httpsUrl = z.string().url().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "El enlace debe usar HTTPS.");

export const ApplicantSchema = z.object({
  name: z.string().trim().min(2, "El nombre completo es obligatorio.").max(120, "El nombre es demasiado largo."),
  email: z.string().trim().email("Formato de correo inválido.").toLowerCase().max(254),
  phone: z.string().trim().min(10, "El número de teléfono debe incluir al menos 10 caracteres.").max(25, "El número de teléfono es demasiado largo.").regex(/^[+0-9().\\s-]+$/, "El teléfono contiene caracteres no válidos."),
  efsetLink: httpsUrl,
  cvUrl: httpsUrl.optional(),
});

export type ApplicantData = z.infer<typeof ApplicantSchema>;
