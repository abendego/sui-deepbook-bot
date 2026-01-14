"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var type_name_exports = {};
__export(type_name_exports, {
  TypeName: () => TypeName
});
module.exports = __toCommonJS(type_name_exports);
var import_utils = require("../../../utils/index.js");
var import_bcs = require("@mysten/sui/bcs");
const $moduleName = "std::type_name";
const TypeName = new import_utils.MoveStruct({
  name: `${$moduleName}::TypeName`,
  fields: {
    /**
     * String representation of the type. All types are represented using their source
     * syntax: "u8", "u64", "bool", "address", "vector", and so on for primitive types.
     * Struct types are represented as fully qualified type names; e.g.
     * `00000000000000000000000000000001::string::String` or
     * `0000000000000000000000000000000a::module_name1::type_name1<0000000000000000000000000000000a::module_name2::type_name2<u64>>`
     * Addresses are hex-encoded lowercase values of length ADDRESS_LENGTH (16, 20, or
     * 32 depending on the Move platform)
     */
    name: import_bcs.bcs.string()
  }
});
//# sourceMappingURL=type_name.js.map
