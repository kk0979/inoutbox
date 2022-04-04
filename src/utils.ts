function replacer(key: any, value: any) {
  if (value instanceof Map) {
    return {
      dataType: "Map",
      value: Array.from(value.entries()), // or with spread: value: [...value]
    };
  } else {
    return value;
  }
}
function reviver(key: any, value: any) {
  if (typeof value === "object" && value !== null) {
    if (value.dataType === "Map") {
      return new Map(value.value);
    }
  }
  return value;
}

export function JSONstringify(o: any): string {
  return JSON.stringify(o, replacer);
}

export function JSONparse(json: string): any {
  return JSON.parse(json, reviver);
}
