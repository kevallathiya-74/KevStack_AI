type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function TextareaEditor({ value, onChange, placeholder }: Props) {
  return (
    <textarea
      className="textarea"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={10}
    />
  );
}
