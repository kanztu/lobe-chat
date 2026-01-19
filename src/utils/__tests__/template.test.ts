import { describe, expect, it } from 'vitest';

import { extractVariables, interpolatePrompt, testPayloadMapping, validateJsonPath } from '../template';

describe('Template Engine', () => {
  describe('interpolatePrompt', () => {
    it('should interpolate simple variables', () => {
      const template = 'Process issue #{{issueNumber}}: {{issueTitle}}';
      const payload = { issue: { number: 123, title: 'Bug in upload' } };
      const mapping = {
        issueNumber: '$.issue.number',
        issueTitle: '$.issue.title',
      };

      const result = interpolatePrompt(template, payload, mapping);

      expect(result).toBe('Process issue #123: Bug in upload');
    });

    it('should interpolate nested object data', () => {
      const template = 'User {{author}} opened issue';
      const payload = { issue: { user: { login: 'john' } } };
      const mapping = { author: '$.issue.user.login' };

      const result = interpolatePrompt(template, payload, mapping);

      expect(result).toBe('User john opened issue');
    });

    it('should handle missing variables by keeping placeholders', () => {
      const template = 'Title: {{title}}, Author: {{author}}';
      const payload = { title: 'Test' };
      const mapping = {
        author: '$.missing.field',
        title: '$.title',
      };

      const result = interpolatePrompt(template, payload, mapping);

      expect(result).toBe('Title: Test, Author: {{author}}');
    });

    it('should stringify objects', () => {
      const template = 'Labels: {{labels}}';
      const payload = { labels: ['bug', 'urgent'] };
      const mapping = { labels: '$.labels' };

      const result = interpolatePrompt(template, payload, mapping);

      expect(result).toContain('[\n  "bug",\n  "urgent"\n]');
    });

    it('should handle empty mapping', () => {
      const template = 'No variables here';
      const payload = { data: 'test' };
      const mapping = {};

      const result = interpolatePrompt(template, payload, mapping);

      expect(result).toBe('No variables here');
    });

    it('should handle multiple occurrences of same variable', () => {
      const template = '{{name}} says: Hello {{name}}!';
      const payload = { name: 'Alice' };
      const mapping = { name: '$.name' };

      const result = interpolatePrompt(template, payload, mapping);

      expect(result).toBe('Alice says: Hello Alice!');
    });

    it('should handle special characters in values', () => {
      const template = 'Message: {{message}}';
      const payload = { message: 'Hello "world" & <friends>' };
      const mapping = { message: '$.message' };

      const result = interpolatePrompt(template, payload, mapping);

      expect(result).toBe('Message: Hello "world" & <friends>');
    });
  });

  describe('validateJsonPath', () => {
    it('should validate correct JSONPath expressions', () => {
      expect(validateJsonPath('$.issue.number')).toBe(true);
      expect(validateJsonPath('$.data[0].value')).toBe(true);
      expect(validateJsonPath('$..title')).toBe(true);
    });

    it('should validate against sample payload', () => {
      const payload = { issue: { number: 123 } };

      expect(validateJsonPath('$.issue.number', payload)).toBe(true);
      expect(validateJsonPath('$.missing.field', payload)).toBe(true); // Valid path, just no data
    });

    it('should handle edge case expressions', () => {
      // JSONPath is permissive - even weird paths are "valid" syntax
      // They just won't match anything in the payload
      expect(validateJsonPath('$.anything')).toBe(true);
    });
  });

  describe('extractVariables', () => {
    it('should extract all variables from template', () => {
      const template = 'Process {{type}} #{{number}}: {{title}}';

      const variables = extractVariables(template);

      expect(variables).toEqual(['type', 'number', 'title']);
    });

    it('should handle templates with no variables', () => {
      const template = 'No variables here';

      const variables = extractVariables(template);

      expect(variables).toEqual([]);
    });

    it('should remove duplicate variables', () => {
      const template = '{{name}} says {{name}} again';

      const variables = extractVariables(template);

      expect(variables).toEqual(['name']);
    });

    it('should match word characters including underscores', () => {
      const template = '{{valid}} {{with-dash}} {{with_underscore}}';

      const variables = extractVariables(template);

      // \w matches alphanumeric + underscore, so "with_underscore" is one variable
      // "with-dash" doesn't match (dash breaks the pattern)
      expect(variables).toEqual(['valid', 'with_underscore']);
    });
  });

  describe('testPayloadMapping', () => {
    it('should test successful mapping', () => {
      const template = 'Issue {{number}}: {{title}}';
      const payload = { issue: { number: 123, title: 'Bug' } };
      const mapping = {
        number: '$.issue.number',
        title: '$.issue.title',
      };

      const result = testPayloadMapping(template, payload, mapping);

      expect(result.success).toBe(true);
      expect(result.result).toBe('Issue 123: Bug');
      expect(result.variables.number.extracted).toBe(true);
      expect(result.variables.number.value).toBe(123);
      expect(result.variables.title.extracted).toBe(true);
      expect(result.variables.title.value).toBe('Bug');
      expect(result.errors).toEqual([]);
    });

    it('should report extraction failures', () => {
      const template = 'User {{name}}';
      const payload = { data: 'test' };
      const mapping = { name: '$.missing.field' };

      const result = testPayloadMapping(template, payload, mapping);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.variables.name.extracted).toBe(false);
      expect(result.variables.name.value).toBeNull();
    });

    it('should handle invalid JSONPath', () => {
      const template = 'Value {{val}}';
      const payload = { value: 123 };
      const mapping = { val: 'invalid[' };

      const result = testPayloadMapping(template, payload, mapping);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Error message contains the variable name and indicates extraction failure
      expect(result.errors[0]).toContain('val');
    });

    it('should test with complex nested data', () => {
      const template = 'Order {{orderId}} for {{email}} - {{amount}} {{currency}}';
      const payload = {
        data: {
          object: {
            amount: 5000,
            currency: 'USD',
            customer_email: 'user@example.com',
            id: 'ord_123',
          },
        },
      };
      const mapping = {
        amount: '$.data.object.amount',
        currency: '$.data.object.currency',
        email: '$.data.object.customer_email',
        orderId: '$.data.object.id',
      };

      const result = testPayloadMapping(template, payload, mapping);

      expect(result.success).toBe(true);
      expect(result.result).toBe('Order ord_123 for user@example.com - 5000 USD');
    });
  });
});
