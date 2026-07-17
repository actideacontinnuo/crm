/**
 * Unit tests — Reglas de comisión (Brief v2 §3)
 */
const { aplicarReglasComision, NATALIA, PROPIETARIOS_ESPECIALES } = require('../../api/_roles');

describe('Regla 1 — Origen Apollo', () => {
  test('Apollo impone Propietario y Ejec. de cuenta = Natalia, sin comisión', () => {
    const r = aplicarReglasComision({ propietario: 'Ximena', ejecCuenta: 'Ximena' }, { esApollo: true });
    expect(r.propietario).toBe(NATALIA);
    expect(r.ejecCuenta).toBe(NATALIA);
    expect(r.comision).toBeNull();
    expect(r.regla).toBe(1);
  });
});

describe('Regla 2 — Propietario == Ejecutivo de cuenta (15%)', () => {
  test('mismo dueño → 15%', () => {
    const r = aplicarReglasComision({ propietario: 'Ximena', ejecCuenta: 'Ximena' });
    expect(r.comision).toBe(15);
    expect(r.regla).toBe(2);
  });

  test('tiene prioridad sobre Regla 3 (propietario especial que también es ejec. de cuenta)', () => {
    const r = aplicarReglasComision({ propietario: 'Eduardo Gama', ejecCuenta: 'Eduardo Gama' });
    expect(r.comision).toBe(15); // gana R2, no el 7.5% de R3
    expect(r.regla).toBe(2);
  });
});

describe('Regla 3 — Propietario es Eduardo Gama o Alfredo (7.5%)', () => {
  test.each(PROPIETARIOS_ESPECIALES)('%s → ejec. de cuenta Natalia y 7.5%', (owner) => {
    const r = aplicarReglasComision({ propietario: owner, ejecCuenta: 'Alexia' });
    expect(r.ejecCuenta).toBe(NATALIA);
    expect(r.comision).toBe(7.5);
    expect(r.regla).toBe(3);
  });
});

describe('Regla 4 — Caso general (sin comisión)', () => {
  test('propietario normal distinto del ejec. de cuenta → sin comisión gestionada', () => {
    const r = aplicarReglasComision({ propietario: 'Ximena', ejecCuenta: 'Alexia' });
    expect(r.comision).toBeNull();
    expect(r.regla).toBe(4);
  });

  test('sin datos → todo vacío, sin comisión', () => {
    const r = aplicarReglasComision({});
    expect(r.comision).toBeNull();
    expect(r.regla).toBe(4);
  });
});
