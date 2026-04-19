import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Table } from './Table';
import { DataGrid } from './DataGrid';

// Mock data
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'inactive';
  joinDate: string;
}

const users: User[] = [
  { id: '1', name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', status: 'active', joinDate: '2023-01-15' },
  { id: '2', name: 'Bob Smith', email: 'bob@example.com', role: 'User', status: 'active', joinDate: '2023-02-20' },
  { id: '3', name: 'Charlie Davis', email: 'charlie@example.com', role: 'Editor', status: 'inactive', joinDate: '2023-03-10' },
  { id: '4', name: 'Diana Prince', email: 'diana@example.com', role: 'User', status: 'active', joinDate: '2023-04-05' },
  { id: '5', name: 'Ethan Hunt', email: 'ethan@example.com', role: 'Admin', status: 'active', joinDate: '2023-05-12' },
  { id: '6', name: 'Fiona Apple', email: 'fiona@example.com', role: 'Editor', status: 'inactive', joinDate: '2023-06-18' },
  { id: '7', name: 'George Miller', email: 'george@example.com', role: 'User', status: 'active', joinDate: '2023-07-22' },
  { id: '8', name: 'Hannah Montana', email: 'hannah@example.com', role: 'User', status: 'active', joinDate: '2023-08-30' },
  { id: '9', name: 'Ian Malcolm', email: 'ian@example.com', role: 'Editor', status: 'active', joinDate: '2023-09-14' },
  { id: '10', name: 'Jane Doe', email: 'jane@example.com', role: 'Admin', status: 'inactive', joinDate: '2023-10-01' },
];

// Generate more users for pagination
const generateUsers = (count: number): User[] => {
  const roles = ['Admin', 'User', 'Editor'];
  const statuses: ('active' | 'inactive')[] = ['active', 'inactive'];
  const result: User[] = [];

  for (let i = 1; i <= count; i++) {
    result.push({
      id: String(i),
      name: `User ${i}`,
      email: `user${i}@example.com`,
      role: roles[i % 3],
      status: statuses[i % 2],
      joinDate: `2023-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
    });
  }

  return result;
};

const largeUserList = generateUsers(100);

const columns = [
  {
    key: 'name',
    header: 'Name',
    accessor: (user: User) => user.name,
    sortable: true,
    width: '200px',
  },
  {
    key: 'email',
    header: 'Email',
    accessor: (user: User) => user.email,
    sortable: true,
  },
  {
    key: 'role',
    header: 'Role',
    accessor: (user: User) => (
      <span
        style={{
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: '600',
          backgroundColor:
            user.role === 'Admin'
              ? '#fef3c7'
              : user.role === 'Editor'
              ? '#dbeafe'
              : '#e5e7eb',
          color:
            user.role === 'Admin'
              ? '#92400e'
              : user.role === 'Editor'
              ? '#1e40af'
              : '#374151',
        }}
      >
        {user.role}
      </span>
    ),
    width: '120px',
  },
  {
    key: 'status',
    header: 'Status',
    accessor: (user: User) => (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: user.status === 'active' ? '#10b981' : '#ef4444',
          }}
        />
        {user.status === 'active' ? 'Active' : 'Inactive'}
      </span>
    ),
    sortable: true,
    width: '120px',
  },
  {
    key: 'joinDate',
    header: 'Join Date',
    accessor: (user: User) => new Date(user.joinDate).toLocaleDateString(),
    sortable: true,
    width: '140px',
  },
];

// Meta configuration
const meta: Meta<typeof Table> = {
  title: 'UI/Table',
  component: Table,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Table>;

// Stories
export const BasicTable: Story = {
  args: {
    columns,
    data: users,
    keyExtractor: (user) => user.id,
  },
};

export const SortableTable: Story = {
  render: () => {
    const [sortBy, setSortBy] = useState<string>('name');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    return (
      <Table
        columns={columns}
        data={users}
        keyExtractor={(user) => user.id}
        sortable
        sortBy={sortBy}
        sortDirection={sortDirection}
        onSort={(column, direction) => {
          setSortBy(column);
          setSortDirection(direction);
        }}
        hoverable
      />
    );
  },
};

export const SelectableTable: Story = {
  render: () => {
    const [selectedRows, setSelectedRows] = useState<string[]>([]);

    return (
      <div>
        <p style={{ marginBottom: '16px', color: '#6b7280' }}>
          Selected: {selectedRows.length} row(s)
        </p>
        <Table
          columns={columns}
          data={users}
          keyExtractor={(user) => user.id}
          selectable
          selectedRows={selectedRows}
          onSelectionChange={setSelectedRows}
          sortable
          hoverable
        />
      </div>
    );
  },
};

export const TableWithActions: Story = {
  render: () => {
    const actionsColumn = [
      ...columns,
      {
        key: 'actions',
        header: 'Actions',
        accessor: (user: User) => (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={{
                padding: '4px 12px',
                fontSize: '0.875rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                background: 'white',
                cursor: 'pointer',
              }}
              onClick={() => alert(`Edit ${user.name}`)}
            >
              Edit
            </button>
            <button
              style={{
                padding: '4px 12px',
                fontSize: '0.875rem',
                border: '1px solid #fca5a5',
                borderRadius: '4px',
                background: 'white',
                color: '#dc2626',
                cursor: 'pointer',
              }}
              onClick={() => alert(`Delete ${user.name}`)}
            >
              Delete
            </button>
          </div>
        ),
        width: '180px',
      },
    ];

    return (
      <Table
        columns={actionsColumn}
        data={users}
        keyExtractor={(user) => user.id}
        hoverable
      />
    );
  },
};

export const TableWithPagination: Story = {
  render: () => {
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    return (
      <DataGrid
        columns={columns}
        data={largeUserList}
        keyExtractor={(user) => user.id}
        pagination
        currentPage={currentPage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        sortable
        hoverable
        striped
      />
    );
  },
};

export const TableWithFilters: Story = {
  render: () => {
    const [currentPage, setCurrentPage] = useState(1);
    const [searchValue, setSearchValue] = useState('');
    const [filters, setFilters] = useState([
      {
        key: 'role',
        label: 'Role',
        type: 'select' as const,
        options: [
          { value: 'Admin', label: 'Admin' },
          { value: 'Editor', label: 'Editor' },
          { value: 'User', label: 'User' },
        ],
        value: '',
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select' as const,
        options: [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ],
        value: '',
      },
    ]);

    const filteredData = largeUserList.filter((user) => {
      const matchesSearch =
        searchValue === '' ||
        user.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        user.email.toLowerCase().includes(searchValue.toLowerCase());

      const roleFilter = filters.find((f) => f.key === 'role');
      const matchesRole = !roleFilter?.value || user.role === roleFilter.value;

      const statusFilter = filters.find((f) => f.key === 'status');
      const matchesStatus = !statusFilter?.value || user.status === statusFilter.value;

      return matchesSearch && matchesRole && matchesStatus;
    });

    return (
      <DataGrid
        columns={columns}
        data={filteredData}
        keyExtractor={(user) => user.id}
        pagination
        currentPage={currentPage}
        pageSize={25}
        onPageChange={setCurrentPage}
        searchable
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        filters={filters}
        onFilterChange={setFilters}
        sortable
        hoverable
      />
    );
  },
};

export const DataGridWithAllFeatures: Story = {
  render: () => {
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [searchValue, setSearchValue] = useState('');
    const [selectedRows, setSelectedRows] = useState<string[]>([]);

    const DownloadIcon = () => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8.5 1.5a.5.5 0 0 0-1 0v8.793l-2.646-2.647a.5.5 0 0 0-.708.708l3.5 3.5a.5.5 0 0 0 .708 0l3.5-3.5a.5.5 0 0 0-.708-.708L8.5 10.293V1.5z" />
        <path d="M2 13.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 0-1h-11a.5.5 0 0 0-.5.5z" />
      </svg>
    );

    const TrashIcon = () => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
        <path
          fillRule="evenodd"
          d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
        />
      </svg>
    );

    const EditIcon = () => (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z" />
      </svg>
    );

    const filteredData = largeUserList.filter((user) => {
      return (
        searchValue === '' ||
        user.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        user.email.toLowerCase().includes(searchValue.toLowerCase())
      );
    });

    return (
      <DataGrid
        columns={columns}
        data={filteredData}
        keyExtractor={(user) => user.id}
        selectable
        selectedRows={selectedRows}
        onSelectionChange={setSelectedRows}
        pagination
        currentPage={currentPage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        searchable
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        sortable
        hoverable
        striped
        actions={[
          {
            label: 'Download',
            icon: <DownloadIcon />,
            onClick: (user) => alert(`Download data for ${user.name}`),
          },
          {
            label: 'Edit',
            icon: <EditIcon />,
            onClick: (user) => alert(`Edit ${user.name}`),
          },
          {
            label: 'Delete',
            icon: <TrashIcon />,
            onClick: (user) => alert(`Delete ${user.name}`),
            variant: 'danger',
          },
        ]}
        bulkActions={[
          {
            label: 'Export selected',
            icon: <DownloadIcon />,
            onClick: (ids) => alert(`Export ${ids.length} users`),
          },
          {
            label: 'Delete selected',
            icon: <TrashIcon />,
            onClick: (ids) => alert(`Delete ${ids.length} users`),
            variant: 'danger',
          },
        ]}
      />
    );
  },
};

export const LoadingTable: Story = {
  args: {
    columns,
    data: users,
    keyExtractor: (user) => user.id,
    loading: true,
  },
};

export const EmptyTable: Story = {
  args: {
    columns,
    data: [],
    keyExtractor: (user) => user.id,
    emptyMessage: 'No users found. Try adjusting your filters or search query.',
  },
};

export const StickyHeaderTable: Story = {
  render: () => (
    <div style={{ maxHeight: '400px', overflow: 'auto' }}>
      <Table
        columns={columns}
        data={largeUserList}
        keyExtractor={(user) => user.id}
        stickyHeader
        hoverable
        sortable
      />
    </div>
  ),
};

export const StripedTable: Story = {
  args: {
    columns,
    data: users,
    keyExtractor: (user) => user.id,
    striped: true,
    hoverable: true,
  },
};

export const CompactTable: Story = {
  args: {
    columns,
    data: users,
    keyExtractor: (user) => user.id,
    size: 'sm',
    hoverable: true,
    striped: true,
  },
};

export const LargeTable: Story = {
  args: {
    columns,
    data: users,
    keyExtractor: (user) => user.id,
    size: 'lg',
    hoverable: true,
  },
};

export const ClickableRows: Story = {
  render: () => {
    const [clickedUser, setClickedUser] = useState<string | null>(null);

    return (
      <div>
        {clickedUser && (
          <div
            style={{
              padding: '12px 16px',
              marginBottom: '16px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '8px',
              color: '#1e40af',
            }}
          >
            Last clicked: <strong>{clickedUser}</strong>
          </div>
        )}
        <Table
          columns={columns}
          data={users}
          keyExtractor={(user) => user.id}
          onRowClick={(user) => setClickedUser(user.name)}
          hoverable
        />
      </div>
    );
  },
};

export const DarkMode: Story = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: () => (
    <div style={{ colorScheme: 'dark' }}>
      <Table
        columns={columns}
        data={users}
        keyExtractor={(user) => user.id}
        sortable
        hoverable
        striped
      />
    </div>
  ),
};
