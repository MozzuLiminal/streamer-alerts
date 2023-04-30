export const mapToJson = (map: Map<any, any>) => {
  const obj: Record<any, any> = {};

  map.forEach((value, key) => (obj[key] = value));

  return JSON.stringify(obj);
};

export const jsonToMap = (jsonStringOrObj: string | Record<any, any>) => {
  if (typeof jsonStringOrObj === 'string') jsonStringOrObj = JSON.parse(jsonStringOrObj);

  const map = new Map();

  Object.entries(jsonStringOrObj).forEach((key, value) => {
    map.set(key, value);
  });

  return map;
};
