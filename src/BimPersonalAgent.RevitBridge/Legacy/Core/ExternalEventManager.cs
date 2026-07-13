using System;
using System.Collections.Generic;
using Autodesk.Revit.UI;

namespace RevitMCP.Core
{
    /// <summary>
    /// 外部事件管理器
    /// 確保命令在 Revit UI 執行緒中執行
    /// </summary>
    public class ExternalEventManager
    {
        private static ExternalEventManager _instance;
        private static readonly object _lock = new object();
        
        private ExternalEvent _externalEvent;
        private CommandEventHandler _eventHandler;

        private ExternalEventManager()
        {
            _eventHandler = new CommandEventHandler();
            _externalEvent = ExternalEvent.Create(_eventHandler);
        }

        public static ExternalEventManager Instance
        {
            get
            {
                lock (_lock)
                {
                    if (_instance == null)
                    {
                        _instance = new ExternalEventManager();
                    }
                    return _instance;
                }
            }
        }

        /// <summary>
        /// 執行命令
        /// </summary>
        public void ExecuteCommand(Action<UIApplication> action)
        {
            if (action == null)
            {
                throw new ArgumentNullException(nameof(action));
            }

            _eventHandler.Enqueue(action);
            _externalEvent.Raise();
        }

        public int PendingCount => _eventHandler.PendingCount;

        /// <summary>
        /// 命令事件處理器
        /// </summary>
        private class CommandEventHandler : IExternalEventHandler
        {
            private readonly object _queueLock = new object();
            private readonly Queue<Action<UIApplication>> _actions = new Queue<Action<UIApplication>>();

            public int PendingCount
            {
                get
                {
                    lock (_queueLock)
                    {
                        return _actions.Count;
                    }
                }
            }

            public void Enqueue(Action<UIApplication> action)
            {
                lock (_queueLock)
                {
                    _actions.Enqueue(action);
                }
            }

            public void Execute(UIApplication app)
            {
                while (true)
                {
                    Action<UIApplication> action;
                    lock (_queueLock)
                    {
                        if (_actions.Count == 0)
                        {
                            return;
                        }

                        action = _actions.Dequeue();
                    }

                    try
                    {
                        action(app);
                    }
                    catch (Exception ex)
                    {
                        Logger.Error("ExternalEvent queued command failed", ex);
                    }
                }
            }

            public string GetName()
            {
                return "BIM Personal Agent queued command handler";
            }
        }
    }
}
