import Sidebar from './components/layout/Sidebar'
import TabBar from './components/layout/TabBar'
import Canvas from './components/Canvas/Canvas'
import Toolbar from './components/ui/Toolbar'

export default function App() {
  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TabBar />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Canvas />
          <Toolbar />
        </div>
      </div>
    </div>
  )
}
