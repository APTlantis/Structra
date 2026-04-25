import type { DocumentModel } from "./types";

export const initialDocument: DocumentModel = {
  version: "1.0.0",
  nodes: [
    {
      id: "node-name",
      type: "text",
      label: "Name",
      binding: "user.name",
      value: "Ada Lovelace",
      children: [],
      props: {
        dataType: "string",
        nullable: false,
        isArray: false,
      },
    },
    {
      id: "node-age",
      type: "number",
      label: "Age",
      binding: "user.age",
      value: 36,
      children: [],
      props: {
        dataType: "number",
        nullable: false,
        isArray: false,
      },
    },
    {
      id: "node-active",
      type: "checkbox",
      label: "Active",
      binding: "user.active",
      value: true,
      children: [],
      props: {
        dataType: "boolean",
        nullable: false,
        isArray: false,
      },
    },
    {
      id: "node-profile",
      type: "section",
      label: "Profile",
      binding: "user.profile",
      value: null,
      props: {
        dataType: "object",
        nullable: false,
        isArray: false,
      },
      children: [
        {
          id: "node-role",
          type: "select",
          label: "Role",
          binding: "role",
          value: "Engineer",
          children: [],
          props: {
            dataType: "string",
            nullable: false,
            isArray: false,
            options: ["Engineer", "Designer", "Operator"],
          },
        },
      ],
    },
  ],
  layout: {
    kind: "grid",
    columns: 2,
  },
  meta: {
    name: "Structured Data Builder",
    format: "ui-schema",
  },
};
