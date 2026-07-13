using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using Autodesk.Revit.UI;
using BimPersonalAgent.Core;
using WpfTextBox = System.Windows.Controls.TextBox;

namespace BimPersonalAgent.Revit
{
    internal sealed class AgentPane : UserControl, IDockablePaneProvider
    {
        private readonly CommandParser _parser = new CommandParser();
        private readonly WpfTextBox _commandInput;
        private readonly WpfTextBox _parameterInput;
        private readonly WpfTextBox _valueInput;
        private readonly DataGrid _results;
        private readonly TextBlock _status;

        private Action<AgentRequest> _submitRequest;
        private bool _busy;

        public AgentPane()
        {
            Background = new SolidColorBrush(Color.FromRgb(247, 248, 250));
            MinWidth = 380;

            var root = new Grid { Margin = new Thickness(14) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var header = new StackPanel { Margin = new Thickness(0, 0, 0, 12) };
            header.Children.Add(new TextBlock
            {
                Text = "BIM 個人作業台",
                FontSize = 20,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Color.FromRgb(31, 41, 55))
            });
            header.Children.Add(new TextBlock
            {
                Text = "Revit 2024 · Codex + MCP 測試模式",
                Margin = new Thickness(0, 4, 0, 0),
                Foreground = new SolidColorBrush(Color.FromRgb(75, 85, 99))
            });
            Grid.SetRow(header, 0);
            root.Children.Add(header);

            var commandArea = CreateSection("自然語言指令");
            _commandInput = new WpfTextBox
            {
                Text = "設定 備註 = 已檢查",
                MaxLength = 1200,
                Margin = new Thickness(0, 6, 0, 8),
                Padding = new Thickness(8, 6, 8, 6)
            };
            commandArea.Children.Add(_commandInput);

            var commandButtons = new StackPanel { Orientation = Orientation.Horizontal };
            var parseButton = CreateButton("本機解析執行", 112);
            parseButton.Click += ParseCommand;
            commandButtons.Children.Add(parseButton);
            var inspectButton = CreateButton("檢查目前選取", 112);
            inspectButton.Margin = new Thickness(8, 0, 0, 0);
            inspectButton.Click += (sender, args) => Submit(new AgentRequest
            {
                Kind = AgentRequestKind.InspectSelection
            });
            commandButtons.Children.Add(inspectButton);
            commandArea.Children.Add(commandButtons);
            Grid.SetRow(commandArea, 1);
            root.Children.Add(commandArea);

            var editorArea = CreateSection("參數變更");
            editorArea.Margin = new Thickness(0, 12, 0, 12);
            var fields = new Grid { Margin = new Thickness(0, 6, 0, 8) };
            fields.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            fields.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            _parameterInput = CreateField("參數名稱", fields, 0);
            _valueInput = CreateField("新值", fields, 1);
            _parameterInput.MaxLength = 100;
            _valueInput.MaxLength = 1000;
            editorArea.Children.Add(fields);

            var actionButtons = new StackPanel { Orientation = Orientation.Horizontal };
            var executeButton = CreateButton("執行修改", 100);
            executeButton.Click += (sender, args) => ExecuteParameterChange();
            actionButtons.Children.Add(executeButton);
            editorArea.Children.Add(actionButtons);
            Grid.SetRow(editorArea, 2);
            root.Children.Add(editorArea);

            _results = CreateResultsGrid();
            Grid.SetRow(_results, 3);
            root.Children.Add(_results);

            _status = new TextBlock
            {
                Text = "Codex 測試請在 Codex 對話輸入；此欄可直接執行本機受限修改。",
                Margin = new Thickness(0, 10, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                Foreground = new SolidColorBrush(Color.FromRgb(75, 85, 99))
            };
            Grid.SetRow(_status, 4);
            root.Children.Add(_status);

            Content = root;
        }

        public void SetupDockablePane(DockablePaneProviderData data)
        {
            data.FrameworkElement = this;
            data.InitialState = new DockablePaneState { DockPosition = DockPosition.Right };
        }

        internal void Initialize(Action<AgentRequest> submitRequest)
        {
            _submitRequest = submitRequest ?? throw new ArgumentNullException(nameof(submitRequest));
        }

        internal void ShowRows(IReadOnlyList<OperationRow> rows, string status)
        {
            _results.ItemsSource = rows;
            _status.Text = status;
            _busy = false;
        }

        internal void SetBusy(bool busy)
        {
            if (busy)
            {
                _busy = true;
                _status.Text = "正在讀取 Revit 模型…";
            }
        }

        private void ParseCommand(object sender, RoutedEventArgs args)
        {
            CommandParseResult result = _parser.Parse(_commandInput.Text);
            if (!result.Success)
            {
                _status.Text = result.Error;
                return;
            }

            if (result.Intent.Kind == CommandKind.InspectSelection)
            {
                Submit(new AgentRequest { Kind = AgentRequestKind.InspectSelection });
                return;
            }

            _parameterInput.Text = result.Intent.ParameterName;
            _valueInput.Text = result.Intent.Value;
            ExecuteParameterChange();
        }

        private void ExecuteParameterChange()
        {
            string parameterName = _parameterInput.Text.Trim();
            string value = _valueInput.Text.Trim();
            if (parameterName.Length == 0 || value.Length == 0)
            {
                _status.Text = "參數名稱與新值都不能空白。";
                return;
            }

            Submit(new AgentRequest
            {
                Kind = AgentRequestKind.ApplyParameterChange,
                ParameterName = parameterName,
                Value = value
            });
        }

        private void Submit(AgentRequest request)
        {
            if (_submitRequest == null)
            {
                _status.Text = "Agent 命令佇列尚未初始化。";
                return;
            }

            if (_busy)
            {
                _status.Text = "上一個作業仍在執行，請稍後再試。";
                return;
            }

            SetBusy(true);
            _submitRequest(request);
        }

        private static StackPanel CreateSection(string title)
        {
            var panel = new StackPanel();
            panel.Children.Add(new TextBlock
            {
                Text = title,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Color.FromRgb(55, 65, 81))
            });
            return panel;
        }

        private static WpfTextBox CreateField(string label, Grid parent, int column)
        {
            var group = new StackPanel
            {
                Margin = column == 0 ? new Thickness(0, 0, 5, 0) : new Thickness(5, 0, 0, 0)
            };
            group.Children.Add(new TextBlock { Text = label });
            var field = new WpfTextBox
            {
                Margin = new Thickness(0, 4, 0, 0),
                Padding = new Thickness(8, 5, 8, 5)
            };
            group.Children.Add(field);
            Grid.SetColumn(group, column);
            parent.Children.Add(group);
            return field;
        }

        private static Button CreateButton(string text, double width)
        {
            return new Button
            {
                Content = text,
                Width = width,
                Height = 30,
                Padding = new Thickness(8, 3, 8, 3)
            };
        }

        private static DataGrid CreateResultsGrid()
        {
            var grid = new DataGrid
            {
                AutoGenerateColumns = false,
                IsReadOnly = true,
                CanUserAddRows = false,
                HeadersVisibility = DataGridHeadersVisibility.Column,
                GridLinesVisibility = DataGridGridLinesVisibility.Horizontal,
                MinHeight = 180
            };
            grid.Columns.Add(Column("ID", "Id", 68));
            grid.Columns.Add(Column("類別", "Category", 110));
            grid.Columns.Add(Column("元素", "Element", 140));
            grid.Columns.Add(Column("參數", "Parameter", 100));
            grid.Columns.Add(Column("目前值", "CurrentValue", 110));
            grid.Columns.Add(Column("新值", "ProposedValue", 110));
            grid.Columns.Add(Column("狀態", "State", 150));
            return grid;
        }

        private static DataGridTextColumn Column(string header, string path, double width)
        {
            return new DataGridTextColumn
            {
                Header = header,
                Binding = new Binding(path),
                Width = new DataGridLength(width)
            };
        }
    }
}
