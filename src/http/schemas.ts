import { z } from 'zod';
import { AppError, type ErrorCode } from '../errors/app-error.js';

// Letras de cualquier alfabeto (incluye tildes, ñ y ü), espacios, apóstrofo y guion.
const NAME_REGEX = /^[\p{L}' -]+$/u;

export const createValidationSchema = z.object({
  name: z
    .string()
    .transform((value) => value.normalize('NFC').trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(3, 'Debe tener al menos 3 caracteres')
        .max(100, 'Debe tener máximo 100 caracteres')
        .regex(NAME_REGEX, 'Solo se permiten letras, espacios, apóstrofo y guion'),
    ),
  documentNumber: z
    .string()
    .transform((value) => value.replace(/[.\s-]/g, ''))
    .pipe(z.string().regex(/^\d{6,10}$/, 'Debe tener entre 6 y 10 dígitos')),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Debe ser un código ISO 3166-1 alpha-2 de dos letras')
    .default('CO'),
});

export type CreateValidationBody = z.infer<typeof createValidationSchema>;

// Regex explícito: ObjectId.isValid acepta cualquier string de 12 caracteres.
export const idParamsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Debe ser un id de 24 caracteres hexadecimales'),
});

export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  data: unknown,
  code: ErrorCode,
  message: string,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppError(400, code, message, details);
  }
  return result.data;
}
