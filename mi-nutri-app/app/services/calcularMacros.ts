export type Nutrientes = {
  calorias: number;
  proteinas: number;
  grasas: number;
  grasasSaturadas: number;
  carbohidratos: number;
  azucares: number;
  fibra: number;
  sal: number;
};

export function calcularMacros(nutrientesPor100g: Nutrientes, gramos: number): Nutrientes {
  const f = gramos / 100;
  return {
    calorias: nutrientesPor100g.calorias * f,
    proteinas: nutrientesPor100g.proteinas * f,
    grasas: nutrientesPor100g.grasas * f,
    grasasSaturadas: nutrientesPor100g.grasasSaturadas * f,
    carbohidratos: nutrientesPor100g.carbohidratos * f,
    azucares: nutrientesPor100g.azucares * f,
    fibra: nutrientesPor100g.fibra * f,
    sal: nutrientesPor100g.sal * f,
  };
}