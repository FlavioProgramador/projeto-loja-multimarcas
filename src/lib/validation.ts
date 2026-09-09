export const validateCPF = (cpf: string): boolean => {
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf) || /^\d{11}$/.test(cpf);
};

export const validateName = (name: string): boolean => {
  return name.trim().length >= 2 && name.length <= 100 && /^[a-zA-ZÀ-ÿ\s]+$/.test(name);
};

export const validateQuantity = (qty: number): boolean => {
  return qty > 0 && Number.isInteger(qty);
};

export const validatePrice = (price: number): boolean => {
  return price >= 0 && !isNaN(price);
};
