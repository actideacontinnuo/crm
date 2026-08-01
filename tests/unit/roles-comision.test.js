/**
 * Unit tests — Reglas de comisión (arquitectura confirmada):
 * El Propietario de la cuenta (quien la trajo) es SIEMPRE el mismo que el
 * Ejecutivo de cuenta (quien la atiende) — EXCEPTO Eduardo Gama y Alfredo,
 * que son socios/externos, nunca ejecutivos: para ellos se sigue forzando
 * Ejec. de cuenta = Natalia (Regla 3, 7.5%). El Ejecutivo de cuenta YA NO es
 * una entrada independiente: aplicarReglasComision siempre la deriva/fuerza,
 * ignorando cualquier valor de ejecCuenta que venga en los datos de entrada.
 */
const { aplicarReglasComision, NATALIA, PROPIETARIOS_ESPECIALES } = require('../../api/_roles');

describe('Apollo — Natalia propietaria por default, comisión con las MISMAS reglas', () => {
  test('sin propietario: default Natalia → Natalia también es ejec. de cuenta (Regla 2, 15%)', () => {
    const r = aplicarReglasComision({ ejecCuenta: 'Alexia' }, { esApollo: true }); // 'Alexia' se ignora: se deriva
    expect(r.propietario).toBe(NATALIA);
    expect(r.ejecCuenta).toBe(NATALIA);
    expect(r.comision).toBe(15);
    expect(r.regla).toBe(2);
  });

  test('Natalia propietaria y también ejec. de cuenta → Regla 2, 15%', () => {
    const r = aplicarReglasComision({ ejecCuenta: NATALIA }, { esApollo: true });
    expect(r.propietario).toBe(NATALIA);
    expect(r.comision).toBe(15);
    expect(r.regla).toBe(2);
  });

  test('Apollo no pisa un propietario ya capturado (respeta la regla que aplique)', () => {
    const r = aplicarReglasComision({ propietario: 'Eduardo Gama', ejecCuenta: 'Alexia' }, { esApollo: true });
    expect(r.propietario).toBe('Eduardo Gama');
    expect(r.ejecCuenta).toBe(NATALIA); // forzado, 'Alexia' se ignora
    expect(r.comision).toBe(7.5); // Regla 3
    expect(r.regla).toBe(3);
  });
});

describe('Regla 2 — Propietario = Ejecutivo de cuenta SIEMPRE (15%)', () => {
  test('propietario normal → ejec. de cuenta se deriva igual, sin importar qué venga', () => {
    const r = aplicarReglasComision({ propietario: 'Ximena', ejecCuenta: 'Ximena' });
    expect(r.ejecCuenta).toBe('Ximena');
    expect(r.comision).toBe(15);
    expect(r.regla).toBe(2);
  });

  test('el ejec. de cuenta enviado por el cliente se IGNORA — siempre se deriva del propietario', () => {
    // Antes esto caía en "Regla 4, manual". Ahora la combinación es imposible:
    // el sistema fuerza ejecCuenta = propietario, ignorando 'Alexia'.
    const r = aplicarReglasComision({ propietario: 'Ximena', ejecCuenta: 'Alexia' });
    expect(r.ejecCuenta).toBe('Ximena');
    expect(r.comision).toBe(15);
    expect(r.regla).toBe(2);
  });
});

describe('Regla 3 — Propietario es Eduardo Gama o Alfredo (7.5%) — excepción confirmada', () => {
  test.each(PROPIETARIOS_ESPECIALES)('%s → ejec. de cuenta Natalia y 7.5%, SIEMPRE (no la puede pisar Regla 2)', (owner) => {
    const r = aplicarReglasComision({ propietario: owner, ejecCuenta: owner }); // intento de "mismo dueño" no aplica
    expect(r.ejecCuenta).toBe(NATALIA);
    expect(r.comision).toBe(7.5);
    expect(r.regla).toBe(3);
  });
});

describe('Regla 4 — Sin propietario asignado (sin comisión)', () => {
  test('sin propietario y sin datos → todo vacío, sin comisión', () => {
    const r = aplicarReglasComision({});
    expect(r.propietario).toBe('');
    expect(r.ejecCuenta).toBe('');
    expect(r.comision).toBeNull();
    expect(r.regla).toBe(4);
  });

  test('propietario fuera de ambos rosters (dato corrupto/externo) → sin comisión, no se inventa nada', () => {
    const r = aplicarReglasComision({ propietario: 'Alguien Externo' });
    expect(r.ejecCuenta).toBe('');
    expect(r.comision).toBeNull();
    expect(r.regla).toBe(4);
  });
});
