/**
 * Unit tests — Funciones de lectura/escritura de propiedades Notion
 * Estas funciones son el puente entre la lógica de negocio y Notion.
 * Un error aquí corrompe silenciosamente todos los datos.
 */
const {
  prop_title, prop_text, prop_number, prop_select, prop_date, prop_checkbox, prop_email, prop_phone,
  read_title, read_text, read_number, read_select, read_date, read_checkbox, read_email, read_phone,
} = require('../../api/notion');

// ── Prop Builders ──────────────────────────────────────────
describe('prop_title', () => {
  test('envuelve string en estructura Notion', () => {
    const r = prop_title('Empresa SA');
    expect(r.title[0].text.content).toBe('Empresa SA');
  });
  test('convierte null a string vacío', () => {
    expect(prop_title(null).title[0].text.content).toBe('');
  });
  test('trunca a 2000 caracteres', () => {
    const long = 'a'.repeat(3000);
    expect(prop_title(long).title[0].text.content.length).toBe(2000);
  });
});

describe('prop_text', () => {
  test('wrap básico', () => {
    const r = prop_text('hola mundo');
    expect(r.rich_text[0].text.content).toBe('hola mundo');
  });
  test('string vacío produce array vacío', () => {
    expect(prop_text('').rich_text).toHaveLength(0);
  });
  test('null produce array vacío', () => {
    expect(prop_text(null).rich_text).toHaveLength(0);
  });
});

describe('prop_number', () => {
  test('número positivo', () => expect(prop_number(42).number).toBe(42));
  test('cero', ()          => expect(prop_number(0).number).toBe(0));
  test('decimal',  ()      => expect(prop_number(1.5).number).toBe(1.5));
  test('string numérico',  () => expect(prop_number('100').number).toBe(100));
  test('NaN → null',       () => expect(prop_number('abc').number).toBeNull());
  test('undefined → null', () => expect(prop_number(undefined).number).toBeNull());
});

describe('prop_select', () => {
  test('string válido', () => expect(prop_select('Activo').select.name).toBe('Activo'));
  test('null → select null', () => expect(prop_select(null).select).toBeNull());
  test('string vacío → select null', () => expect(prop_select('').select).toBeNull());
});

describe('prop_date', () => {
  test('fecha ISO', () => expect(prop_date('2026-07-01').date.start).toBe('2026-07-01'));
  test('null → date null', () => expect(prop_date(null).date).toBeNull());
});

describe('prop_checkbox', () => {
  test('true',  () => expect(prop_checkbox(true).checkbox).toBe(true));
  test('false', () => expect(prop_checkbox(false).checkbox).toBe(false));
  test('truthy value', () => expect(prop_checkbox(1).checkbox).toBe(true));
  test('falsy value',  () => expect(prop_checkbox(0).checkbox).toBe(false));
});

describe('prop_email', () => {
  test('email válido', () => expect(prop_email('a@b.com').email).toBe('a@b.com'));
  test('null → null',  () => expect(prop_email(null).email).toBeNull());
});

// ── Prop Readers ───────────────────────────────────────────
describe('read_title', () => {
  test('lee texto del título', () =>
    expect(read_title({ title: [{ plain_text: 'Test' }] })).toBe('Test'));
  test('prop undefined → cadena vacía', () =>
    expect(read_title(undefined)).toBe(''));
  test('array vacío → cadena vacía', () =>
    expect(read_title({ title: [] })).toBe(''));
});

describe('read_text', () => {
  test('concatena múltiples rich_text', () =>
    expect(read_text({ rich_text: [{ plain_text: 'Hola' }, { plain_text: ' mundo' }] })).toBe('Hola mundo'));
  test('undefined → cadena vacía', () =>
    expect(read_text(undefined)).toBe(''));
});

describe('read_number', () => {
  test('número normal', () => expect(read_number({ number: 99 })).toBe(99));
  test('cero',         () => expect(read_number({ number: 0 })).toBe(0));
  test('undefined → 0', () => expect(read_number(undefined)).toBe(0));
  test('null number → 0', () => expect(read_number({ number: null })).toBe(0));
});

describe('read_select', () => {
  test('devuelve nombre del select', () =>
    expect(read_select({ select: { name: 'Admin' } })).toBe('Admin'));
  test('null select → cadena vacía', () =>
    expect(read_select({ select: null })).toBe(''));
  test('undefined → cadena vacía', () =>
    expect(read_select(undefined)).toBe(''));
});

describe('read_checkbox', () => {
  test('true', ()  => expect(read_checkbox({ checkbox: true })).toBe(true));
  test('false', () => expect(read_checkbox({ checkbox: false })).toBe(false));
  test('undefined → false', () => expect(read_checkbox(undefined)).toBe(false));
});

// ── Round-trip (write → read) ──────────────────────────────
// NOTA: title y rich_text NO pueden hacer round-trip directo:
// prop_title/prop_text generan formato "write" ({ text: { content } })
// pero read_title/read_text esperan formato "read" ({ plain_text }) que Notion
// añade automáticamente al devolver datos.  El round-trip real ocurre en el
// mock de tests (mock-notion._materializeProps) o en la API real.
// Los tipos que sí son simétricos se testean aquí.
describe('Round-trip prop write/read', () => {
  test('number',   () => expect(read_number(prop_number(42))).toBe(42));
  test('select',   () => expect(read_select(prop_select('X'))).toBe('X'));
  test('checkbox', () => expect(read_checkbox(prop_checkbox(true))).toBe(true));
  test('email',    () => expect(read_email(prop_email('x@y.com'))).toBe('x@y.com'));

  // title/text: formato write NO tiene plain_text; se testea la estructura esperada
  test('prop_title genera estructura write correcta', () => {
    const p = prop_title('Acme');
    expect(p.title[0].text.content).toBe('Acme');
  });
  test('prop_text genera estructura write correcta', () => {
    const p = prop_text('hello');
    expect(p.rich_text[0].text.content).toBe('hello');
  });
  test('read_title lee plain_text (formato read)', () => {
    expect(read_title({ title: [{ plain_text: 'Acme' }] })).toBe('Acme');
  });
  test('read_text lee plain_text (formato read)', () => {
    expect(read_text({ rich_text: [{ plain_text: 'hello' }] })).toBe('hello');
  });
});

describe('prop_number con vacío/null (regresión)', () => {
  const { prop_number } = require('../../api/notion');
  test('cadena vacía → number null (no 0)', () => {
    expect(prop_number('').number).toBeNull();
    expect(prop_number(null).number).toBeNull();
    expect(prop_number(undefined).number).toBeNull();
  });
  test('número válido se preserva', () => {
    expect(prop_number(1500).number).toBe(1500);
    expect(prop_number('2500').number).toBe(2500);
    expect(prop_number(0).number).toBe(0); // cero explícito sí es 0
  });
});
