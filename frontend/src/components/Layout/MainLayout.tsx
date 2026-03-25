import React, { useCallback, useRef } from 'react';
import { Layout } from 'antd';
import { TopNav } from '../Nav/TopNav';
import { ConnectionTree } from '../Sidebar/ConnectionTree';
import { ConnectionProperties } from '../Sidebar/ConnectionProperties';
import { SessionTabs } from '../Tabs/SessionTabs';

const { Content } = Layout;

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 600;
const DEFAULT_SIDEBAR = 260;

const MIN_PROPERTIES_HEIGHT = 150;
const DEFAULT_TREE_FRACTION = 0.6;

export const MainLayout: React.FC = () => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  // Horizontal sidebar resize — direct DOM manipulation, no React re-renders
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (me: MouseEvent) => {
      if (!sidebarRef.current) return;
      const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, me.clientX));
      sidebarRef.current.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Vertical splitter between tree and properties — direct DOM manipulation
  const onVMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (me: MouseEvent) => {
      if (!sidebarRef.current || !treeRef.current) return;
      const rect = sidebarRef.current.getBoundingClientRect();
      const totalHeight = rect.height;
      const relativeY = me.clientY - rect.top;
      const propertiesHeight = totalHeight - relativeY;
      if (propertiesHeight < MIN_PROPERTIES_HEIGHT || relativeY < MIN_PROPERTIES_HEIGHT) return;
      treeRef.current.style.flex = `0 0 ${(relativeY / totalHeight) * 100}%`;
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <TopNav />

      <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
        {/* Resizable sidebar */}
        <div
          ref={sidebarRef}
          style={{
            width: DEFAULT_SIDEBAR,
            flexShrink: 0,
            borderRight: '1px solid var(--mr-border)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--mr-bg-sidebar)',
          }}
        >
          {/* Connection tree (top) */}
          <div ref={treeRef} style={{ flex: `0 0 ${DEFAULT_TREE_FRACTION * 100}%`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ConnectionTree />
          </div>

          {/* Vertical splitter */}
          <div
            onMouseDown={onVMouseDown}
            className="mr-splitter"
            style={{
              height: 5,
              cursor: 'row-resize',
              flexShrink: 0,
              zIndex: 10,
            }}
          />

          {/* Connection properties (bottom) */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <ConnectionProperties />
          </div>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={onMouseDown}
          className="mr-splitter"
          style={{
            width: 5,
            cursor: 'col-resize',
            flexShrink: 0,
            zIndex: 10,
          }}
        />

        {/* Main content area */}
        <Content
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SessionTabs />
        </Content>
      </div>
    </Layout>
  );
};
