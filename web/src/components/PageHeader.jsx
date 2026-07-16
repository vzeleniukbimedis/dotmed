export default function PageHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="page-header">
      <div className="page-header-icon">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div>
        <h2 className="page-title">{title}</h2>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}
